// Multi-Bank / White-Label Tenant Resolution

export type TenantConfig = {
  id: string;
  name: string;
  brand: {
    logo_url: string;
    primary_color: string;
    company_name: string;
    support_email: string;
  };
  etran: {
    lender_id: string;
    service_center: string;
    enabled: boolean;
  };
  features: {
    auto_narrative: boolean;
    auto_agents: boolean;
    borrower_portal: boolean;
  };
};

// In production, load from database
const TENANT_CONFIGS: Record<string, TenantConfig> = {
  "acme-bank": {
    id: "acme-bank",
    name: "Acme Community Bank",
    brand: {
      logo_url: "https://example.com/acme-logo.png",
      primary_color: "#0066CC",
      company_name: "Acme Community Bank",
      support_email: "sba@acmebank.com",
    },
    etran: {
      lender_id: "ACME001",
      service_center: "ATLANTA",
      enabled: true,
    },
    features: {
      auto_narrative: true,
      auto_agents: true,
      borrower_portal: true,
    },
  },
  "demo-bank": {
    id: "demo-bank",
    name: "Demo Bank",
    brand: {
      logo_url: "https://example.com/demo-logo.png",
      primary_color: "#FF6600",
      company_name: "Demo Bank",
      support_email: "sba@demobank.com",
    },
    etran: {
      lender_id: "DEMO001",
      service_center: "SACRAMENTO",
      enabled: false, // Demo mode - no real submissions
    },
    features: {
      auto_narrative: true,
      auto_agents: false,
      borrower_portal: true,
    },
  },
};

export function resolveTenant(tenantId: string): TenantConfig | null {
  return TENANT_CONFIGS[tenantId] || null;
}

export function getTenantFromRequest(req: Request): string | null {
  // Option 1: From subdomain (e.g., acme-bank.buddy.com)
  const host = req.headers.get("host");
  if (host) {
    const subdomain = host.split(".")[0];
    if (TENANT_CONFIGS[subdomain]) {
      return subdomain;
    }
  }

  // Option 2: From custom header
  const tenantHeader = req.headers.get("x-tenant-id");
  if (tenantHeader && TENANT_CONFIGS[tenantHeader]) {
    return tenantHeader;
  }

  // Option 3: From query param (for testing)
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("tenant_id");
  if (tenantParam && TENANT_CONFIGS[tenantParam]) {
    return tenantParam;
  }

  return null;
}

export function getBrandConfig(tenantId: string) {
  const tenant = resolveTenant(tenantId);
  return tenant?.brand || {
    logo_url: "",
    primary_color: "#000000",
    company_name: "SBA Lending Platform",
    support_email: "support@example.com",
  };
}

export function getEtranConfig(tenantId: string) {
  const tenant = resolveTenant(tenantId);
  return tenant?.etran || {
    lender_id: "UNKNOWN",
    service_center: "UNKNOWN",
    enabled: false,
  };
}
