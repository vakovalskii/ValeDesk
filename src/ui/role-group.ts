import type { ApiSettings, RoleGroupRoleConfig, RoleGroupSettings } from "./types";

export const ROLE_GROUP_DEFAULTS: RoleGroupSettings = {
  roles: [
    {
      id: "product_manager",
      name: "Product Manager",
      enabled: true,
      model: "",
      prompt: "Определи бизнес-ценность, цели, метрики успеха, границы и приоритеты. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "team_lead",
      name: "Team Lead",
      enabled: true,
      model: "",
      prompt: "Разбей работу на задачи для разработчиков, оцени риски и зависимости, синхронизируйся с аналитиком. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "backend_dev",
      name: "Backend Developer",
      enabled: true,
      model: "",
      prompt: "Спроектируй API, модели данных и план реализации бэкенда. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "frontend_dev",
      name: "Frontend Developer",
      enabled: true,
      model: "",
      prompt: "Спроектируй UI- потоки, компоненты и фронтенд-интеграцию. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      model: "",
      prompt: "Уточни требования, крайние случаи и критерии приемки. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "qa",
      name: "QA Engineer",
      enabled: true,
      model: "",
      prompt: "Составь тест-план, критичные сценарии и регрессионные проверки. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "devops",
      name: "DevOps Engineer",
      enabled: true,
      model: "",
      prompt: "Определи требования к деплою, CI/CD, наблюдаемости и инфраструктуре. Веди чеклист плана и отмечай выполненные пункты."
    },
    {
      id: "architect",
      name: "Architect",
      enabled: true,
      model: "",
      prompt: "Оцени архитектуру, масштабирование и компромиссы. Веди чеклист плана и отмечай выполненные пункты."
    }
  ]
};

export function getRoleGroupSettings(settings?: ApiSettings | null): RoleGroupSettings {
  const savedRoles = settings?.roleGroupSettings?.roles ?? [];
  const mergedRoles: RoleGroupRoleConfig[] = ROLE_GROUP_DEFAULTS.roles.map((role) => {
    const saved = savedRoles.find((r) => r.id === role.id);
    return {
      ...role,
      ...saved,
      name: saved?.name || role.name
    };
  });

  for (const saved of savedRoles) {
    if (!mergedRoles.find((role) => role.id === saved.id)) {
      mergedRoles.push(saved);
    }
  }

  return { roles: mergedRoles };
}
