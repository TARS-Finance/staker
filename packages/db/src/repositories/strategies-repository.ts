import { and, eq, lte } from "drizzle-orm";
import { strategies } from "../../drizzle/schema.js";
import type { StackerDatabase } from "../client.js";

export class StrategiesRepository {
  constructor(private readonly db: StackerDatabase) {}

  async create(values: typeof strategies.$inferInsert) {
    const [strategy] = await this.db
      .insert(strategies)
      .values(values)
      .returning();

    if (!strategy) {
      throw new Error("Failed to create strategy");
    }

    return strategy;
  }

  async findById(id: string) {
    return this.db.query.strategies.findFirst({
      where: eq(strategies.id, id)
    });
  }

  async findByUserId(userId: string) {
    return this.db.query.strategies.findMany({
      where: eq(strategies.userId, userId)
    });
  }

  async updateStatus(id: string, status: typeof strategies.$inferInsert.status) {
    const [strategy] = await this.db
      .update(strategies)
      .set({ status, updatedAt: new Date() })
      .where(eq(strategies.id, id))
      .returning();

    if (!strategy) {
      throw new Error(`Failed to update strategy status for ${id}`);
    }

    return strategy;
  }

  async findDueActiveStrategies(now: Date) {
    return this.db.query.strategies.findMany({
      where: and(
        eq(strategies.status, "active"),
        lte(strategies.nextEligibleAt, now)
      )
    });
  }
}
