const dashboardByRole = {
  production: "/index.html",
  analyst: "/historico.html",
  management: "/gerencial.html"
};

async function getCurrentUser() {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Não foi possível verificar a sessão.");

  const payload = await response.json();
  return payload.user;
}

function showAuthMessage(message, isError = true) {
  const element = document.getElementById("authMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.toggle("success", !isError);
}

export async function initializeAuthPage(formId, endpoint) {
  try {
    const user = await getCurrentUser();
    if (user) {
      window.location.replace(dashboardByRole[user.role]);
      return;
    }
  } catch (error) {
    showAuthMessage(error.message);
  }

  const form = document.getElementById(formId);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthMessage("");

    const formData = new FormData(form);
    const password = formData.get("password");
    if (endpoint === "/api/auth/register" &&
        password !== formData.get("confirmPassword")) {
      showAuthMessage("As senhas não coincidem.");
      return;
    }

    const body = Object.fromEntries(formData.entries());
    delete body.confirmPassword;
    if (typeof body.email === "string") body.email = body.email.trim();

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível acessar a conta.");
      }

      window.location.replace(dashboardByRole[payload.user.role]);
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
}

export async function requireDashboardRole(requiredRole) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error("Erro ao validar sessão:", error);
    document.body.dataset.authError = "true";
    throw error;
  }

  if (!user) {
    window.location.replace("/login.html");
    return new Promise(() => {});
  }

  const expectedDashboard = dashboardByRole[requiredRole];
  if (user.role !== requiredRole) {
    window.location.replace(dashboardByRole[user.role] || "/login.html");
    return new Promise(() => {});
  }

  document.querySelectorAll(".page-nav-link").forEach((link) => {
    const target = new URL(link.href, window.location.href).pathname;
    link.hidden = target !== expectedDashboard;
  });

  const statusGroup = document.querySelector(".status-group");
  if (statusGroup && !document.getElementById("logoutButton")) {
    const logoutButton = document.createElement("button");
    logoutButton.id = "logoutButton";
    logoutButton.className = "auth-logout-button";
    logoutButton.type = "button";
    logoutButton.textContent = "Sair";
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        if (!response.ok) {
          throw new Error("Não foi possível encerrar a sessão.");
        }
        window.location.replace("/login.html");
      } catch (error) {
        console.error("Erro ao encerrar sessão:", error);
        window.alert(error.message);
        logoutButton.disabled = false;
      }
    });
    statusGroup.appendChild(logoutButton);
  }

  return user;
}
