const { expect } = require("chai");
const hre = require("hardhat");

describe("Pausable Security Tests", function () {
  async function deployContracts() {
    const [owner, agent, provider, other] = await hre.ethers.getSigners();

    // Deploy mock ERC20 token (USDC)
    const MockToken = await hre.ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy("Mock USDC", "USDC");
    await token.waitForDeployment();

    // Deploy TrustEngine
    const TrustEngine = await hre.ethers.getContractFactory("TrustEngine");
    const trustEngine = await hre.upgrades.deployProxy(
      TrustEngine,
      [owner.address],
      {
        kind: "uups",
        initializer: "initialize",
      },
    );
    await trustEngine.waitForDeployment();

    // Deploy GatewaySession
    const GatewaySession = await hre.ethers.getContractFactory(
      "GatewaySession",
    );
    const gatewaySession = await hre.upgrades.deployProxy(
      GatewaySession,
      [await trustEngine.getAddress(), owner.address],
      {
        kind: "uups",
        initializer: "initialize",
      },
    );
    await gatewaySession.waitForDeployment();

    // Set GatewaySession as authorized in TrustEngine
    await trustEngine.setGatewaySession(await gatewaySession.getAddress());

    // Mint tokens to agent and approve TrustEngine
    const DEPOSIT_AMOUNT = hre.ethers.parseUnits("100", 6); // 100 USDC
    await token.mint(agent.address, DEPOSIT_AMOUNT);
    await token
      .connect(agent)
      .approve(await trustEngine.getAddress(), DEPOSIT_AMOUNT);

    return {
      trustEngine,
      gatewaySession,
      token,
      owner,
      agent,
      provider,
      other,
      DEPOSIT_AMOUNT,
    };
  }

  describe("TrustEngine Pausability", function () {
    it("should allow owner to pause and unpause", async function () {
      const { trustEngine, owner, other } = await deployContracts();

      // Only owner can pause
      await expect(trustEngine.connect(other).pause()).to.be.revertedWithCustomError(
        trustEngine,
        "OwnableUnauthorizedAccount",
      );

      await trustEngine.connect(owner).pause();
      expect(await trustEngine.paused()).to.be.true;

      // Only owner can unpause
      await expect(trustEngine.connect(other).unpause()).to.be.revertedWithCustomError(
        trustEngine,
        "OwnableUnauthorizedAccount",
      );

      await trustEngine.connect(owner).unpause();
      expect(await trustEngine.paused()).to.be.false;
    });

    it("should revert deposit/withdraw when paused", async function () {
      const { trustEngine, owner, agent, token, DEPOSIT_AMOUNT } =
        await deployContracts();

      await trustEngine.connect(owner).pause();

      // Try deposit
      await expect(
        trustEngine.connect(agent).deposit(await token.getAddress(), DEPOSIT_AMOUNT),
      ).to.be.revertedWithCustomError(trustEngine, "EnforcedPause");

      // Unpause and deposit
      await trustEngine.connect(owner).unpause();
      await trustEngine
        .connect(agent)
        .deposit(await token.getAddress(), DEPOSIT_AMOUNT);

      // Pause again
      await trustEngine.connect(owner).pause();

      // Try withdraw
      await expect(
        trustEngine.connect(agent).withdraw(await token.getAddress(), DEPOSIT_AMOUNT),
      ).to.be.revertedWithCustomError(trustEngine, "EnforcedPause");
    });

    it("should revert deal creation when paused", async function () {
      const { trustEngine, owner, agent, provider, token, DEPOSIT_AMOUNT } =
        await deployContracts();

      // Deposit first
      await trustEngine
        .connect(agent)
        .deposit(await token.getAddress(), DEPOSIT_AMOUNT);

      await trustEngine.connect(owner).pause();

      const dealId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deal1"));
      const amount = hre.ethers.parseUnits("10", 6);

      await expect(
        trustEngine.connect(agent).createDeal(
          dealId,
          provider.address,
          await token.getAddress(),
          amount,
          "0x",
          hre.ethers.ZeroHash,
          0,
        ),
      ).to.be.revertedWithCustomError(trustEngine, "EnforcedPause");
    });
  });

  describe("GatewaySession Pausability", function () {
    it("should allow owner to pause and unpause", async function () {
      const { gatewaySession, owner, other } = await deployContracts();

      // Only owner can pause
      await expect(gatewaySession.connect(other).pause()).to.be.revertedWithCustomError(
        gatewaySession,
        "OwnableUnauthorizedAccount",
      );

      await gatewaySession.connect(owner).pause();
      expect(await gatewaySession.paused()).to.be.true;

      // Only owner can unpause
      await expect(gatewaySession.connect(other).unpause()).to.be.revertedWithCustomError(
        gatewaySession,
        "OwnableUnauthorizedAccount",
      );

      await gatewaySession.connect(owner).unpause();
      expect(await gatewaySession.paused()).to.be.false;
    });

    it("should revert session operations when paused", async function () {
      const {
        trustEngine,
        gatewaySession,
        owner,
        agent,
        provider,
        other,
        token,
        DEPOSIT_AMOUNT,
      } = await deployContracts();

      // Setup: Deposit to TrustEngine
      await trustEngine
        .connect(agent)
        .deposit(await token.getAddress(), DEPOSIT_AMOUNT);

      // Setup: Register Gateway (unpaused)
      const slug = "test-gateway";
      const price = hre.ethers.parseUnits("1", 6);
      await gatewaySession.connect(provider).registerGateway(slug, price);

      await gatewaySession.connect(owner).pause();

      // 1. Try to open session
      const deposit = hre.ethers.parseUnits("10", 6);
      await expect(
        gatewaySession
          .connect(agent)
          .openSession(slug, await token.getAddress(), deposit, 3600),
      ).to.be.revertedWithCustomError(gatewaySession, "EnforcedPause");

      // Unpause to open session
      await gatewaySession.connect(owner).unpause();
      const tx = await gatewaySession
        .connect(agent)
        .openSession(slug, await token.getAddress(), deposit, 3600);
      const receipt = await tx.wait();
      // Extract sessionId (hacky but works for this test structure)
      // In real test we'd parse logs properly, but here we just need a valid sessionId
      // Actually let's just get it from providerSessions
      const sessions = await gatewaySession.getActiveSessions(provider.address);
      const sessionId = sessions[0];

      // Pause again
      await gatewaySession.connect(owner).pause();

      // 2. Try to record usage
      await expect(
        gatewaySession.connect(provider).recordUsage(sessionId, price),
      ).to.be.revertedWithCustomError(gatewaySession, "EnforcedPause");

      // 3. Try to settle session
      await expect(
        gatewaySession.connect(agent).settleSession(sessionId),
      ).to.be.revertedWithCustomError(gatewaySession, "EnforcedPause");

      // 4. Try to register new gateway
      await expect(
        gatewaySession.connect(other).registerGateway("new-slug", price),
      ).to.be.revertedWithCustomError(gatewaySession, "EnforcedPause");
    });
  });
});
