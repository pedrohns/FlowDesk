import Stripe from "stripe";

// ?????????????????????????????????????????????????????????????????
// Stripe Singleton
//
// Mesmo padr�o do Prisma: uma inst�ncia compartilhada para evitar
// criar m�ltiplas conex�es durante o hot reload do Next.js.
// ?????????????????????????????????????????????????????????????????

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});

// ?????????????????????????????????????????????????????????????????
// Planos dispon�veis
//
// Centralize os Price IDs aqui ? nunca espalhe pelo c�digo.
// Quando mudar de plano, altera s� neste lugar.
// ?????????????????????????????????????????????????????????????????

export const PLANS = {
  FREE: {
    name: "Free",
    price: 0,
    priceId: null,
    limits: {
      projects: 3,
      membersPerTenant: 2,
      tasksPerProject: 20,
    },
  },
  PRO: {
    name: "Pro",
    price: 19,
    priceId: {
      monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
      yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
    },
    limits: {
      projects: Infinity,
      membersPerTenant: Infinity,
      tasksPerProject: Infinity,
    },
  },
} as const;

export type PlanKey = keyof typeof PLANS;
export type BillingInterval = "monthly" | "yearly";

interface CreateCheckoutParams {
  tenantId: string;
  userEmail: string;
  interval: BillingInterval;
  stripeCustomerId?: string | null;
}

export async function createCheckoutSession({
  tenantId,
  userEmail,
  interval,
  stripeCustomerId,
}: CreateCheckoutParams) {
  const priceId = PLANS.PRO.priceId[interval];

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",

    // Se o tenant j� tem customer, reutiliza ? evita duplicar no Stripe
    ...(stripeCustomerId
      ? { customer: stripeCustomerId }
      : { customer_email: userEmail }),

    line_items: [{ price: priceId, quantity: 1 }],

    metadata: { tenantId },
    subscription_data: {
      metadata: { tenantId },
      trial_period_days: 7,
    },

    allow_promotion_codes: true,

    success_url: `${process.env.NEXT_PUBLIC_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_URL}/pricing`,
  });

  return { url: session.url!, sessionId: session.id };
}

// ?????????????????????????????????????????????????????????????????
// createCustomerPortalSession
//
// Abre o portal do Stripe onde o usu�rio pode:
//   - Cancelar a assinatura
//   - Trocar de plano (mensal ? anual)
//   - Atualizar cart�o de cr�dito
//   - Ver hist�rico de faturas
//
// Voc� n�o precisa construir nenhuma dessas UIs ? o Stripe faz tudo.
//
// Uso:
//   const { url } = await createCustomerPortalSession(stripeCustomerId)
//   redirect(url)
// ?????????????????????????????????????????????????????????????????

export async function createCustomerPortalSession(
  stripeCustomerId: string,
  returnPath = "/dashboard/settings",
) {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_URL}${returnPath}`,
  });

  return { url: session.url };
}

/**
 * Valida a assinatura do webhook do Stripe.
 * Sempre use esta fun��o ? nunca confie no body sem validar.
 * Uso no Route Handler:
 * const event = constructWebhookEvent(rawBody, signature)
 * @param rawBody
 * @param signature
 * @returns
 */
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}

/**
 * Busca os detalhes de uma subscription diretamente no Stripe.
 * �til para verificar o status atual sem depender do banco.
 * Use na success_url como verifica��o extra ? o webhook pode atrasar.
 * @param subscriptionId
 * @returns
 */
export async function getSubscription(subscriptionId: string) {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });
}
