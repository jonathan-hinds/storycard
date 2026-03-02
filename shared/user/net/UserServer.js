class UserServer {
  constructor(options = {}) {
    this.createUser = options.createUser;
    this.getUserById = options.getUserById;
    this.loginUser = options.loginUser;
    this.updateUserDeck = options.updateUserDeck;
    if (
      typeof this.createUser !== 'function'
      || typeof this.getUserById !== 'function'
      || typeof this.loginUser !== 'function'
      || typeof this.updateUserDeck !== 'function'
    ) {
      throw new Error('UserServer requires createUser, getUserById, loginUser, and updateUserDeck handlers');
    }
  }

  async getUser({ userId } = {}) {
    const user = await this.getUserById(userId);
    return { user };
  }

  async register(credentials = {}) {
    const user = await this.createUser(credentials);
    return { user };
  }

  async login(credentials = {}) {
    const user = await this.loginUser(credentials);
    return { user };
  }

  async saveDeck({ userId, deck } = {}) {
    const user = await this.updateUserDeck(userId, deck);
    return { user };
  }
}

module.exports = {
  UserServer,
};
