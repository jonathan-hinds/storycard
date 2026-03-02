class UserServer {
  constructor(options = {}) {
    this.createUser = options.createUser;
    this.loginUser = options.loginUser;
    this.updateUserDeck = options.updateUserDeck;
    if (typeof this.createUser !== 'function' || typeof this.loginUser !== 'function' || typeof this.updateUserDeck !== 'function') {
      throw new Error('UserServer requires createUser, loginUser, and updateUserDeck handlers');
    }
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
