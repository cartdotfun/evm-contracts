
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ReputationRegistry Interface Completeness", function () {
    let reputationRegistry;
    let owner;
    let identityRegistry;
    let stakingToken;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        stakingToken = await MockERC20.deploy("CART", "CART");
        await stakingToken.waitForDeployment();

        const IdentityRegistry = await ethers.getContractFactory(
            "IdentityRegistry"
        );
        identityRegistry = await upgrades.deployProxy(
            IdentityRegistry,
            [owner.address, await stakingToken.getAddress()],
            {
                kind: "uups",
                initializer: "initialize",
            }
        );
        await identityRegistry.waitForDeployment();

        const ReputationRegistry = await ethers.getContractFactory(
            "ReputationRegistry"
        );
        const reputationRegistryProxy = await upgrades.deployProxy(
            ReputationRegistry,
            [await identityRegistry.getAddress(), owner.address],
            {
                kind: "uups",
                initializer: "initialize",
                unsafeAllow: ["constructor"],
            }
        );
        await reputationRegistryProxy.waitForDeployment();
        
        // Get contract instance at the interface level
        reputationRegistry = await ethers.getContractAt(
            "IReputationRegistry",
            await reputationRegistryProxy.getAddress()
        );
    });

    it("should get identityRegistry address from the interface", async function () {
        const identityRegistryAddress = await reputationRegistry.identityRegistry();
        expect(identityRegistryAddress).to.equal(await identityRegistry.getAddress());
    });
});
