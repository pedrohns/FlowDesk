import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "./db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
      tenantId: string | null;
      role: "OWNER" | "ADMIN" | "MEMBER" | null;
    };
  }

  interface User {
    tenantId?: string | null;
    role?: "OWNER" | "ADMIN" | "MEMBER" | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    tenantId: string | null;
    role: "OWNER" | "ADMIN" | "MEMBER" | null;
  }
}

// ?????????????????????????????????????????????????????????????????
// Configuracao principal
// ?????????????????????????????????????????????????????????????????

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),

  session: { strategy: "jwt" },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // Primeira vez: user acabou de fazer login
      if (user) {
        token.id = user.id!;

        const activeMember = await db.member.findFirst({
          where: { userId: user.id! },
          orderBy: [{ role: "desc" }], // desc: OWNER ? MEMBER ? ADMIN
          select: { tenantId: true, role: true },
        });

        token.tenantId = activeMember?.tenantId ?? null;
        token.role = (activeMember?.role ?? null) as typeof token.role;
      }

      return token;
    },

    // ?? session ????????????????????????????????????????????????
    // Chamado quando a sessao eh lida (em Server Components, hooks, etc).
    // Pega os dados do token JWT e expoe no objeto session.user.
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.tenantId = token.tenantId;
      session.user.role = token.role;
      return session;
    },
  },

  pages: {
    signIn: "/login", // sua pagina de login customizada
    error: "/login", // redireciona erros para o login tambehm
    newUser: "/onboarding", // primeiro login ? cria o workspace
  },
});

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * Retorna a sessao atual ou lanca erro se nao tiver tenantId.
 * Use em Server Actions que operam dentro de um workspace.
 *
 * Uso:
 *   const { user } = await requireTenant()
 *   const projects = await withTenant(user.tenantId, (tx) =>
 *     tx.project.findMany()
 *   )
 */
export async function requireTenant() {
  const session = await requireAuth();
  if (!session.user.tenantId) {
    throw new Error("No workspace found. Complete onboarding first.");
  }
  return session as typeof session & {
    user: typeof session.user & { tenantId: string };
  };
}

/**
 * Troca o tenant ativo na sessao.
 * Util se o usuario pertence a multiplos workspaces.
 *
 * Como usar: invalide o token forcando um novo login,
 * ou use cookies customizados para sobrescrever o tenantId ativo.
 * Ver: https://authjs.dev/guides/refresh-token-rotation
 */
export async function getActiveTenantId(
  userId: string,
): Promise<string | null> {
  const member = await db.member.findFirst({
    where: { userId, role: "OWNER" },
    select: { tenantId: true },
  });
  return member?.tenantId ?? null;
}
