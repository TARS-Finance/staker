import { z } from "zod";
import type { FastifyInstance } from "fastify";

const merchantParamsSchema = z.object({
  initiaAddress: z.string().min(1)
});

export async function merchantsRoutes(app: FastifyInstance) {
  app.get("/merchants/:initiaAddress/balance", async (request, reply) => {
    const parsed = merchantParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.flatten()
      });
    }

    const merchant = await app.services.users.findByInitiaAddress(
      parsed.data.initiaAddress
    );

    if (!merchant) {
      return reply.status(404).send({
        error: "Merchant not found"
      });
    }

    const balance = await app.services.positions.getMerchantBalance(
      merchant.id,
      app.stackerConfig.merchantDemoApyBps
    );

    return reply.send(balance);
  });
}
