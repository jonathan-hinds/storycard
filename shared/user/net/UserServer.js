class UserServer {
  constructor(options = {}) {
    this.createUser = options.createUser;
    this.loginUser = options.loginUser;
    if (typeof this.createUser !== 'function' || typeof this.loginUser !== 'function') {
      throw new Error('UserServer requires createUser and loginUser handlers');
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
}

module.exports = {
  UserServer,
};
