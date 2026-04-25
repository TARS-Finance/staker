import type { FastifyInstance } from "fastify";

export async function landingRoutes(app: FastifyInstance) {
  app.get("/landing/merchant-stats", async (_request, reply) => {
    const stats = await app.services.landing.getMerchantStats();
    return reply.send(stats);
  });
}
