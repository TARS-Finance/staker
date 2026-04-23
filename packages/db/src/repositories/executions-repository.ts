import { desc, eq } from "drizzle-orm";
import { executions } from "../../drizzle/schema.js";
import type { StackerDatabase } from "../client.js";

export class ExecutionsRepository {
  constructor(private readonly db: StackerDatabase) {}

  async create(values: typeof executions.$inferInsert) {
    const [execution] = await this.db
      .insert(executions)
      .values(values)
      .returning();

    if (!execution) {
      throw new Error("Failed to create execution");
    }

    return execution;
  }

  async updateStatus(
    id: string,
    values: Partial<typeof executions.$inferInsert>
  ) {
    const [execution] = await this.db
      .update(executions)
      .set(values)
      .where(eq(executions.id, id))
      .returning();

    if (!execution) {
      throw new Error(`Failed to update execution ${id}`);
    }

    return execution;
  }

  async findLatestForStrategy(strategyId: string) {
    return this.db.query.executions.findFirst({
      where: eq(executions.strategyId, strategyId),
      orderBy: desc(executions.startedAt)
    });
  }

  async listByStrategyId(strategyId: string) {
    return this.db.query.executions.findMany({
      where: eq(executions.strategyId, strategyId),
      orderBy: desc(executions.startedAt)
    });
  }
}
