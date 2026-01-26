import type { ApiSettings, RoleGroupRoleConfig, RoleGroupSettings } from "./types";

export const ROLE_GROUP_DEFAULTS: RoleGroupSettings = {
  roles: [
    {
      id: "product_manager",
      name: "Product Manager",
      enabled: true,
      model: "",
      prompt: "Focus on user needs, scope, priorities, and success criteria."
    },
    {
      id: "team_lead",
      name: "Team Lead",
      enabled: true,
      model: "",
      prompt: "Plan execution steps, risks, and coordination across roles."
    },
    {
      id: "backend_dev",
      name: "Backend Developer",
      enabled: true,
      model: "",
      prompt: "Design APIs, data models, and backend implementation details."
    },
    {
      id: "frontend_dev",
      name: "Frontend Developer",
      enabled: true,
      model: "",
      prompt: "Design UI flow, components, and client-side integration."
    },
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      model: "",
      prompt: "Clarify requirements, edge cases, and acceptance criteria."
    },
    {
      id: "qa",
      name: "QA Engineer",
      enabled: true,
      model: "",
      prompt: "Propose test plan, critical scenarios, and regressions."
    },
    {
      id: "devops",
      name: "DevOps Engineer",
      enabled: true,
      model: "",
      prompt: "Consider deployment, CI/CD, observability, and infra needs."
    },
    {
      id: "architect",
      name: "Architect",
      enabled: true,
      model: "",
      prompt: "Evaluate architecture choices, scalability, and trade-offs."
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
