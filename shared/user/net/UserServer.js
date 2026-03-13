class UserServer {
  constructor(options = {}) {
    this.createUser = options.createUser;
    this.getUserById = options.getUserById;
    this.loginUser = options.loginUser;
    this.updateUserDeck = options.updateUserDeck;
    this.updateUserAvatar = options.updateUserAvatar;
    this.incrementUserMetrics = options.incrementUserMetrics;
    if (
      typeof this.createUser !== 'function'
      || typeof this.getUserById !== 'function'
      || typeof this.loginUser !== 'function'
      || typeof this.updateUserDeck !== 'function'
      || typeof this.updateUserAvatar !== 'function'
      || typeof this.incrementUserMetrics !== 'function'
    ) {
      throw new Error('UserServer requires createUser, getUserById, loginUser, updateUserDeck, updateUserAvatar, and incrementUserMetrics handlers');
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

  async saveAvatar({ userId, avatarImagePath } = {}) {
    const user = await this.updateUserAvatar(userId, avatarImagePath);
    return { user };
  }

  async incrementMetrics({ userId, metricKey, increment, metricIncrements } = {}) {
    const user = metricIncrements
      ? await this.incrementUserMetrics({ userId, metricIncrements })
      : await this.incrementUserMetrics({ userId, metricKey, increment });
    return { user };
  }
}

module.exports = {
  UserServer,
};
