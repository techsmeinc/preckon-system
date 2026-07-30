# Preckon Host — live API response shapes

Captured from the running server. Use as the ground-truth contract when wiring console screens.

## /api/host/v1/me
```json
{
  "status": 200,
  "shape": {
    "id": "string",
    "email": "string",
    "display_name": "string",
    "role": {
      "key": "string",
      "name": "string"
    },
    "permissions": [
      "len=34",
      "string"
    ],
    "two_factor_enabled": "number"
  }
}
```

## /api/host/v1/tenants?limit=2
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=2",
      {
        "id": "string",
        "slug": "string",
        "name": "string",
        "status": "string",
        "region": "string",
        "current_edition_id": "string",
        "edition_key": "string",
        "edition_name": "string",
        "trial_ends_at": "null",
        "primary_contact_email": "string",
        "created_at": "string",
        "subscription_status": "null",
        "seat_cap": "string"
      }
    ],
    "next_cursor": "string"
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001
```json
{
  "status": 200,
  "shape": {
    "id": "string",
    "slug": "string",
    "name": "string",
    "legal_name": "string",
    "status": "string",
    "region": "string",
    "current_edition_id": "string",
    "trial_ends_at": "null",
    "primary_contact_email": "string",
    "provisioned_by": "null",
    "suspended_at": "null",
    "suspended_reason": "null",
    "offboarded_at": "null",
    "entitlement_version": "number",
    "created_at": "string",
    "updated_at": "string",
    "edition_key": "string",
    "edition_name": "string",
    "edition": {
      "id": "string",
      "key": "string",
      "name": "string"
    },
    "theme": {
      "tenant_id": "string",
      "logo_object_key": "null",
      "brand_color": "string",
      "brand_color_dark": "string",
      "accent_color": "string",
      "theme_tokens": {
        "font_family": "string"
      },
      "updated_by": "null",
      "updated_at": "string",
      "logo_url": "null"
    },
    "subscription": {
      "id": "string",
      "tenant_id": "string",
      "edition_id": "string",
      "currency_code": "string",
      "interval": "string",
      "status": "string",
      "seats": "number",
      "coupon_id": "null",
      "custom_amount_minor": "null",
      "trial_end": "null",
      "current_period_start": "string",
      "current_period_end": "string",
      "cancel_at_period_end": "number",
      "canceled_at": "null",
      "stripe_customer_id": "null",
      "stripe_subscription_id": "null",
      "created_at": "string",
      "updated_at": "string",
      "live_tenant": "string"
    },
    "seats_in_use": "number",
    "seat_cap": "string",
    "recent_audit": [
      "len=2",
      {
        "id": "string",
        "occurred_at": "string",
        "action": "string",
        "summary": "string",
        "actor_type": "string"
      }
    ]
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/entitlements
```json
{
  "status": 200,
  "shape": {
    "tenant_id": "string",
    "edition": "string",
    "version": "number",
    "resolved_at": "string",
    "entitlements": {
      "module.tenderlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.drawlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.doclogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.quantlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.costlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.schedulelogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.procurelogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.copilot": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.white_label": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.sso": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.api_access": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.industry_benchmarks": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "limit.seats": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.projects": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.storage_gb": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.audit_export": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "string"
      },
      "metric.drawings": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.boqs": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.estimates": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.procurement_packages": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.copilot_tokens": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      }
    }
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/entitlement-overrides
```json
{
  "status": 200,
  "shape": {
    "data": "[]"
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/subscription
```json
{
  "status": 200,
  "shape": {
    "id": "string",
    "tenant_id": "string",
    "edition_id": "string",
    "currency_code": "string",
    "interval": "string",
    "status": "string",
    "seats": "number",
    "coupon_id": "null",
    "custom_amount_minor": "null",
    "trial_end": "null",
    "current_period_start": "string",
    "current_period_end": "string",
    "cancel_at_period_end": "number",
    "canceled_at": "null",
    "stripe_customer_id": "null",
    "stripe_subscription_id": "null",
    "created_at": "string",
    "updated_at": "string",
    "live_tenant": "string",
    "edition_key": "string",
    "edition_name": "string"
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/usage
```json
{
  "status": 200,
  "shape": [
    "len=5",
    {
      "feature_key": "string",
      "name": "string",
      "consumed": "number",
      "included_quota": "number"
    }
  ]
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/theme
```json
{
  "status": 200,
  "shape": {
    "tenant_id": "string",
    "logo_object_key": "null",
    "brand_color": "string",
    "brand_color_dark": "string",
    "accent_color": "string",
    "theme_tokens": {
      "font_family": "string"
    },
    "updated_by": "null",
    "updated_at": "string",
    "logo_url": "null"
  }
}
```

## /api/host/v1/tenants/10000000-0000-4000-8000-000000000001/impersonation-sessions
```json
{
  "status": 200,
  "shape": {
    "data": "[]",
    "next_cursor": "null"
  }
}
```

## /api/host/v1/subscriptions?limit=2
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=2",
      {
        "id": "string",
        "tenant_id": "string",
        "edition_id": "string",
        "currency_code": "string",
        "interval": "string",
        "status": "string",
        "seats": "number",
        "custom_amount_minor": "null",
        "trial_end": "null",
        "current_period_start": "string",
        "current_period_end": "string",
        "cancel_at_period_end": "number",
        "canceled_at": "null",
        "stripe_subscription_id": "null",
        "created_at": "string",
        "tenant_name": "string",
        "tenant_slug": "string",
        "edition_key": "string",
        "edition_name": "string"
      }
    ],
    "next_cursor": "string"
  }
}
```

## /api/host/v1/invoices?limit=2
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=2",
      {
        "id": "string",
        "tenant_id": "string",
        "subscription_id": "string",
        "currency_code": "string",
        "number": "string",
        "status": "string",
        "subtotal_minor": "number",
        "discount_minor": "number",
        "tax_minor": "number",
        "total_minor": "number",
        "amount_paid_minor": "number",
        "amount_due_minor": "number",
        "period_start": "null",
        "period_end": "null",
        "due_date": "null",
        "issued_at": "string",
        "paid_at": "null",
        "attempt_count": "number",
        "hosted_invoice_url": "null",
        "created_at": "string",
        "tenant_name": "string",
        "tenant_slug": "string"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/billing/summary
```json
{
  "status": 200,
  "shape": {
    "mrr_by_currency": [
      "len=2",
      {
        "currency_code": "string",
        "amount_minor": "number"
      }
    ],
    "status_counts": {
      "trialing": "number",
      "active": "number",
      "past_due": "number",
      "unpaid": "number"
    },
    "health": {
      "failed_payments": "number",
      "upcoming_renewals": "number"
    }
  }
}
```

## /api/host/v1/editions
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=3",
      {
        "id": "string",
        "key": "string",
        "name": "string",
        "description": "string",
        "status": "string",
        "is_public": "number",
        "trial_days": "number",
        "sort_order": "number",
        "created_at": "string",
        "updated_at": "string",
        "module_count": "number",
        "feature_count": "number",
        "tenant_count": "number"
      }
    ]
  }
}
```

## /api/host/v1/editions/matrix
```json
{
  "status": 200,
  "shape": {
    "editions": [
      "len=3",
      {
        "id": "string",
        "key": "string",
        "name": "string"
      }
    ],
    "groups": [
      "len=4",
      {
        "category": "string",
        "features": [
          "len=4",
          {
            "key": "string",
            "name": "string",
            "type": "string",
            "cells": "{…}"
          }
        ]
      }
    ]
  }
}
```

## /api/host/v1/features?limit=3
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=21",
      {
        "id": "string",
        "key": "string",
        "name": "string",
        "description": "null",
        "category": "string",
        "type": "string",
        "value_type": "string",
        "unit": "null",
        "allowed_values": "null",
        "status": "string",
        "sort_order": "number",
        "created_at": "string",
        "updated_at": "string",
        "editions": [
          "len=3",
          "string"
        ]
      }
    ]
  }
}
```

## /api/host/v1/pricing
```json
{
  "status": 200,
  "shape": {
    "editions": [
      "len=3",
      {
        "id": "string",
        "key": "string",
        "name": "string",
        "status": "string",
        "is_public": "boolean",
        "prices": [
          "len=6",
          {
            "currency_code": "string",
            "interval": "string",
            "amount_minor": "number"
          }
        ]
      }
    ],
    "usage_rates": [
      "len=5",
      {
        "feature_key": "string",
        "name": "string",
        "unit": "string",
        "rates": [
          "len=2",
          {
            "currency_code": "string",
            "amount_minor": "number"
          }
        ]
      }
    ],
    "currencies": [
      "len=5",
      {
        "code": "string",
        "name": "string",
        "symbol": "string",
        "minor_unit": "number",
        "is_active": "number",
        "sort_order": "number"
      }
    ]
  }
}
```

## /api/host/v1/currencies
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=5",
      {
        "code": "string",
        "name": "string",
        "symbol": "string",
        "minor_unit": "number",
        "is_active": "number",
        "sort_order": "number"
      }
    ]
  }
}
```

## /api/host/v1/usage-rates
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=7",
      {
        "feature_id": "string",
        "feature_key": "string",
        "feature_name": "string",
        "unit": "string",
        "currency_code": "string",
        "amount_minor": "number",
        "is_active": "number",
        "created_at": "string",
        "updated_at": "string"
      }
    ]
  }
}
```

## /api/host/v1/coupons
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=2",
      {
        "id": "string",
        "code": "string",
        "name": "string",
        "discount_type": "string",
        "percent_off": "null",
        "amount_off_minor": "number",
        "currency_code": "string",
        "duration": "string",
        "duration_months": "null",
        "max_redemptions": "null",
        "redeemed_count": "number",
        "valid_from": "null",
        "valid_until": "null",
        "status": "string",
        "created_at": "string",
        "updated_at": "string"
      }
    ]
  }
}
```

## /api/host/v1/host-users?limit=3
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=1",
      {
        "id": "string",
        "auth_user_id": "string",
        "email": "string",
        "display_name": "string",
        "role_id": "string",
        "status": "string",
        "two_factor_enabled": "number",
        "last_login_at": "null",
        "created_by": "null",
        "created_at": "string",
        "updated_at": "string",
        "role_key": "string",
        "role_name": "string"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/roles
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=5",
      {
        "id": "string",
        "key": "string",
        "name": "string",
        "description": "string",
        "is_system": "number",
        "created_at": "string",
        "updated_at": "string",
        "user_count": "number",
        "permission_keys": [
          "len=31",
          "string"
        ]
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/permissions
```json
{
  "status": 200,
  "shape": {
    "groups": [
      "len=7",
      {
        "category": "string",
        "permissions": [
          "len=3",
          {
            "id": "string",
            "key": "string",
            "category": "string",
            "description": "string"
          }
        ]
      }
    ]
  }
}
```

## /api/host/v1/audit-events?limit=3
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=3",
      {
        "id": "string",
        "seq": "number",
        "occurred_at": "string",
        "actor_host_user_id": "null",
        "actor_type": "string",
        "action": "string",
        "target_type": "string",
        "target_id": "string",
        "target_tenant_id": "string",
        "summary": "string",
        "metadata": {
          "reason": "string"
        },
        "correlation_id": "string",
        "actor_display_name": "null"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/audit-events/verify
```json
{
  "status": 200,
  "shape": {
    "ok": "boolean"
  }
}
```

## /api/host/v1/notifications?limit=3
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=1",
      {
        "id": "string",
        "title": "string",
        "body": "string",
        "audience_type": "string",
        "audience_filter": {},
        "deliver_in_app": "number",
        "deliver_email": "number",
        "status": "string",
        "scheduled_at": "null",
        "sent_at": "string",
        "author_host_user_id": "null",
        "created_at": "string",
        "updated_at": "string",
        "recipient_count": "number",
        "read_count": "number"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/notifications/audience-preview?audience_type=all_tenants&filter=%7B%7D
```json
{
  "status": 200,
  "shape": {
    "audience_type": "string",
    "filter": {},
    "matched_count": "number",
    "sample": [
      "len=5",
      {
        "id": "string",
        "name": "string"
      }
    ]
  }
}
```

## /api/host/v1/host-notifications
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=3",
      {
        "id": "string",
        "kind": "string",
        "severity": "string",
        "title": "string",
        "body": "string",
        "link": "string",
        "target_host_user_id": "null",
        "correlation_id": "null",
        "created_at": "string",
        "is_read": "number",
        "read_at": "null"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/host-notifications/unread-count
```json
{
  "status": 200,
  "shape": {
    "unread": "number"
  }
}
```

## /api/host/v1/settings
```json
{
  "status": 200,
  "shape": {
    "namespaces": {
      "email": {
        "email.api_key_secret_ref": {
          "value": "string",
          "description": "string",
          "updated_at": "string"
        },
        "email.from_address": {
          "value": "string",
          "description": "string",
          "updated_at": "string"
        },
        "email.provider": {
          "value": "string",
          "description": "string",
          "updated_at": "string"
        }
      },
      "entitlements": {
        "entitlements.cache_ttl_seconds": {
          "value": "number",
          "description": "string",
          "updated_at": "string"
        }
      },
      "general": {
        "general.platform_name": {
          "value": "string",
          "description": "string",
          "updated_at": "string"
        }
      },
      "impersonation": {
        "impersonation.max_minutes": {
          "value": "number",
          "description": "string",
          "updated_at": "string"
        }
      },
      "maintenance": {
        "maintenance.enabled": {
          "value": "boolean",
          "description": "string",
          "updated_at": "string"
        },
        "maintenance.message": {
          "value": "string",
          "description": "string",
          "updated_at": "string"
        }
      },
      "offboarding": {
        "offboarding.retention_days": {
          "value": "number",
          "description": "string",
          "updated_at": "string"
        }
      },
      "security": {
        "security.password_min_length": {
          "value": "number",
          "description": "string",
          "updated_at": "string"
        },
        "security.require_2fa": {
          "value": "boolean",
          "description": "string",
          "updated_at": "string"
        },
        "security.session_max_hours": {
          "value": "number",
          "description": "string",
          "updated_at": "string"
        }
      }
    }
  }
}
```

## /api/host/v1/settings/ai/providers
```json
{
  "status": 200,
  "shape": {
    "providers": [
      "len=3",
      {
        "id": "string",
        "key": "string",
        "name": "string",
        "kind": "string",
        "base_url": "string",
        "api_key_secret_ref": "string",
        "status": "string",
        "created_at": "string",
        "updated_at": "string"
      }
    ]
  }
}
```

## /api/host/v1/settings/ai/routing
```json
{
  "status": 200,
  "shape": {
    "tiers": {
      "embedding": [
        "len=1",
        {
          "id": "string",
          "tier": "string",
          "provider_id": "string",
          "provider_key": "string",
          "provider_name": "string",
          "model": "string",
          "priority": "number",
          "params": {
            "max_tokens": "number"
          },
          "is_active": "number",
          "created_at": "string",
          "updated_at": "string"
        }
      ],
      "extraction": [
        "len=1",
        {
          "id": "string",
          "tier": "string",
          "provider_id": "string",
          "provider_key": "string",
          "provider_name": "string",
          "model": "string",
          "priority": "number",
          "params": {
            "max_tokens": "number"
          },
          "is_active": "number",
          "created_at": "string",
          "updated_at": "string"
        }
      ],
      "orchestrator": [
        "len=2",
        {
          "id": "string",
          "tier": "string",
          "provider_id": "string",
          "provider_key": "string",
          "provider_name": "string",
          "model": "string",
          "priority": "number",
          "params": {
            "max_tokens": "number"
          },
          "is_active": "number",
          "created_at": "string",
          "updated_at": "string"
        }
      ]
    }
  }
}
```

## /api/host/v1/settings/email
```json
{
  "status": 200,
  "shape": {
    "config": {
      "email.api_key_secret_ref": "string",
      "email.from_address": "string",
      "email.provider": "string"
    },
    "domains": [
      "len=1",
      {
        "id": "string",
        "domain": "string",
        "status": "string",
        "dns_records": [
          "len=2",
          {
            "type": "string",
            "host": "string",
            "value": "string"
          }
        ],
        "verified_at": "string",
        "created_at": "string",
        "updated_at": "string"
      }
    ]
  }
}
```

## /api/host/v1/observability/queues
```json
{
  "status": 200,
  "shape": {
    "generated_at": "string",
    "source": "string",
    "queues": [
      "len=4",
      {
        "name": "string",
        "depth": "number",
        "in_flight": "number",
        "pending": "number"
      }
    ],
    "workers": [
      "len=3",
      {
        "id": "string",
        "last_seen": "string",
        "status": "string"
      }
    ]
  }
}
```

## /api/host/v1/observability/throughput?window=1h
```json
{
  "status": 200,
  "shape": {
    "window": "string",
    "generated_at": "string",
    "source": "string",
    "series": [
      "len=60",
      {
        "t": "string",
        "jobs_per_min": "number",
        "succeeded": "number",
        "failed": "number"
      }
    ],
    "summary": {
      "total_jobs": "number",
      "success_rate": "number",
      "fail_rate": "number",
      "latency_ms": {
        "p50": "number",
        "p95": "number"
      }
    }
  }
}
```

## /api/host/v1/observability/ai-health
```json
{
  "status": 200,
  "shape": {
    "generated_at": "string",
    "source": "string",
    "providers": [
      "len=2",
      {
        "provider_id": "string",
        "provider_key": "string",
        "provider_name": "string",
        "status": "string",
        "models": [
          "len=2",
          {
            "model": "string",
            "tier": "string",
            "requests": "number",
            "error_rate": "number",
            "latency_ms": "{…}",
            "tokens": "{…}",
            "cost_usd": "number"
          }
        ]
      }
    ]
  }
}
```

## /api/host/v1/observability/failed-jobs?limit=3
```json
{
  "status": 200,
  "shape": {
    "data": [
      "len=1",
      {
        "id": "string",
        "job_id": "string",
        "job_type": "string",
        "queue": "string",
        "tenant_id": "string",
        "error_class": "string",
        "error_message": "string",
        "attempt": "number",
        "max_attempts": "number",
        "correlation_id": "null",
        "failed_at": "string",
        "resolved": "number",
        "resolved_by": "null",
        "resolved_at": "null",
        "resolution_note": "null"
      }
    ],
    "next_cursor": "null"
  }
}
```

## /api/host/v1/internal/entitlements/10000000-0000-4000-8000-000000000001
```json
{
  "status": 200,
  "shape": {
    "tenant_id": "string",
    "edition": "string",
    "version": "number",
    "resolved_at": "string",
    "entitlements": {
      "module.tenderlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.drawlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.doclogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.quantlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.costlogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.schedulelogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.procurelogix": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "module.copilot": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.white_label": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.sso": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.api_access": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "capability.industry_benchmarks": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string"
      },
      "limit.seats": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.projects": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.storage_gb": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "number"
      },
      "limit.audit_export": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "value": "string"
      },
      "metric.drawings": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.boqs": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.estimates": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.procurement_packages": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      },
      "metric.copilot_tokens": {
        "key": "string",
        "type": "string",
        "included": "boolean",
        "source": "string",
        "included_quota": "number"
      }
    }
  }
}
```

