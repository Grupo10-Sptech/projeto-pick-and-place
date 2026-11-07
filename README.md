# Projeto Pick-and-Place

## Executar o projeto

Requisitos: Node.js 20.19+ ou 22.12+, Python e Docker Desktop instalado. O comando de desenvolvimento tenta iniciar o Docker Desktop se ele estiver fechado.

Na pasta do projeto, instale as dependências uma única vez:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm install
```

Inicie tudo com:

```powershell
npm run dev
```

O comando inicia Mosquitto e InfluxDB em containers Docker, a API/simulador Python, o consumidor MQTT e o Vite. Na primeira execução, o Docker baixa as imagens dos serviços. Deixe o terminal aberto; `Ctrl+C` encerra os processos e os containers, preservando os dados do InfluxDB.

Abra o endereço mostrado pelo Vite (por padrão, `http://localhost:5173/`). As páginas disponíveis são:

- Dashboard: `http://localhost:5173/`
- Histórico de incidentes: `http://localhost:5173/historico.html`
- Painel gerencial: `http://localhost:5173/gerencial.html`

O Vite atualiza a página automaticamente quando os arquivos da interface são alterados. Para encerrar todos os processos, pressione `Ctrl+C` no terminal.

## Serviços locais

O ambiente de desenvolvimento usa um token e uma senha locais definidos para a configuração Docker. Eles são apenas para desenvolvimento: não reutilize esses valores em produção. As portas do InfluxDB e Mosquitto são vinculadas ao computador local. O broker Mosquitto do projeto usa a porta 1884 para evitar conflito com instalações locais que já usem a porta padrão 1883. O Vite encaminha solicitações `/api` para o backend Python na porta 8000.

Os dados do InfluxDB ficam em volumes Docker e são preservados ao encerrar `npm run dev`. Para reiniciar os serviços sem apagar esses dados, execute novamente `npm run dev`.

Incidentes novos são gravados diretamente no InfluxDB pelo consumidor MQTT. Histórico, contadores e indicadores também são consultados no banco; o simulador não cria nem atualiza `data/incidents.json`. Se esse arquivo existir de uma execução anterior, ele permanece como arquivo legado e não é mais utilizado.

## Gerar os arquivos de produção

```powershell
npm run build
npm run preview
```
