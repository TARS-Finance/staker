import type { StrategiesRepository, UsersRepository } from "@stacker/db";

export class LandingService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly config: {
      merchantDemoApyBps: number;
    }
  ) {}

  async getMerchantStats() {
    const [merchantCount, poolCount] = await Promise.all([
      this.usersRepository.countAll(),
      this.strategiesRepository.countDistinctActivePools()
    ]);

    return {
      avg_apy_bps: this.config.merchantDemoApyBps,
      merchant_count: merchantCount,
      pool_count: poolCount
    };
  }
}
