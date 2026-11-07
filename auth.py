import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DATABASE = Path(
    os.environ.get(
        "LOCALAPPDATA",
        str(Path.home() / ".local" / "share"),
    )
) / "PickAndPlace" / "users.sqlite3"
DATABASE_PATH = Path(
    os.environ.get("PICK_AND_PLACE_AUTH_DB", str(DEFAULT_DATABASE))
)
SESSION_COOKIE = "pick_and_place_session"
SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60
PASSWORD_ITERATIONS = 310_000
ROLES = {
    "production": "/index.html",
    "analyst": "/historico.html",
    "management": "/gerencial.html",
}
DEFAULT_USERS = (
    ("Marcos", "marcos@vibradata.com", "marcos123", "production"),
    ("Matheus", "matheus@vibradata.com", "matheus123", "analyst"),
    ("Cintia", "cintia@vibradata.com", "cintia123", "management"),
)
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegistrationError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@contextmanager
def _connect():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_auth_database():
    with _connect() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                role TEXT NOT NULL CHECK (
                    role IN ('production', 'analyst', 'management')
                ),
                created_at INTEGER NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash BLOB PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )
        """)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS sessions_expiration "
            "ON sessions(expires_at)"
        )

    seed_default_users()


def seed_default_users():
    with _connect() as connection:
        for name, email, password, role in DEFAULT_USERS:
            salt = secrets.token_bytes(16)
            password_hash = _hash_password(password, salt)
            connection.execute(
                """
                INSERT INTO users (name, email, password_salt, password_hash,
                                  role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    name = excluded.name,
                    password_salt = excluded.password_salt,
                    password_hash = excluded.password_hash,
                    role = excluded.role
                """,
                (name, email, salt, password_hash, role, int(time.time())),
            )
            user_id = connection.execute(
                "SELECT id FROM users WHERE email = ?",
                (email,),
            ).fetchone()["id"]
            connection.execute(
                "DELETE FROM sessions WHERE user_id = ?",
                (user_id,),
            )


def _hash_password(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )


def _user_payload(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "dashboard": ROLES[row["role"]],
    }


def create_user(name, email, password, role):
    name = name.strip() if isinstance(name, str) else ""
    email = email.strip().lower() if isinstance(email, str) else ""

    if not 2 <= len(name) <= 100:
        raise RegistrationError("Informe um nome entre 2 e 100 caracteres.")
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise RegistrationError("Informe um e-mail válido.")
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise RegistrationError("A senha deve ter entre 10 e 128 caracteres.")
    if not isinstance(role, str) or role not in ROLES:
        raise RegistrationError("Selecione um cargo válido.")
    if role == "management":
        authorized_emails = {
            entry.strip().lower()
            for entry in os.environ.get("MANAGEMENT_EMAILS", "").split(",")
            if entry.strip()
        }
        if email not in authorized_emails:
            raise RegistrationError(
                "O cadastro de Gerência é restrito. Solicite autorização "
                "ao administrador do projeto.",
                403,
            )

    salt = secrets.token_bytes(16)
    password_hash = _hash_password(password, salt)

    try:
        with _connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO users (name, email, password_salt, password_hash,
                                  role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, email, salt, password_hash, role, int(time.time())),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError as error:
        raise RegistrationError(
            "Já existe uma conta cadastrada com este e-mail.",
            409,
        ) from error

    return {"id": user_id, "name": name, "email": email, "role": role}


def authenticate_user(email, password):
    email = email.strip().lower() if isinstance(email, str) else ""
    password = password if isinstance(password, str) else ""

    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if row is None:
        _hash_password(password, b"\0" * 16)
        return None

    candidate_hash = _hash_password(password, row["password_salt"])
    if not hmac.compare_digest(candidate_hash, row["password_hash"]):
        return None

    return _user_payload(row)


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("ascii")).digest()
    expires_at = int(time.time()) + SESSION_DURATION_SECONDS

    with _connect() as connection:
        connection.execute(
            "DELETE FROM sessions WHERE expires_at <= ?",
            (int(time.time()),),
        )
        connection.execute(
            """
            INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (?, ?, ?)
            """,
            (token_hash, user_id, expires_at),
        )

    return token


def get_session_user(token):
    if not isinstance(token, str) or not token:
        return None

    token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
    now = int(time.time())

    with _connect() as connection:
        row = connection.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()

    return _user_payload(row) if row else None


def delete_session(token):
    if not isinstance(token, str) or not token:
        return

    token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
    with _connect() as connection:
        connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (token_hash,),
        )
