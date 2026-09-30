const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Этот проект устанавливается через pnpm. Запустите: corepack enable && pnpm install");
  process.exit(1);
}
