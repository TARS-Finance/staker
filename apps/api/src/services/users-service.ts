import { UsersRepository } from "@stacker/db";

export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async register(initiaAddress: string) {
    const existingUser =
      await this.usersRepository.findByInitiaAddress(initiaAddress);

    if (existingUser) {
      return existingUser;
    }

    return this.usersRepository.create(initiaAddress);
  }
}
