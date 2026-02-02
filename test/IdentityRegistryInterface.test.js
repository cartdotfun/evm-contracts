
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("IdentityRegistry Interface Completeness", function () {
    let identityRegistry;
    let stakingToken;
    let owner;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        stakingToken = await MockERC20.deploy("CART", "CART");
        await stakingToken.waitForDeployment();

        const IdentityRegistry = await ethers.getContractFactory(
            "IdentityRegistry"
        );
        const identityRegistryProxy = await upgrades.deployProxy(
            IdentityRegistry,
            [owner.address, await stakingToken.getAddress()],
            {
                kind: "uups",
                initializer: "initialize",
            }
        );
        await identityRegistryProxy.waitForDeployment();
        
        // Get contract instance at the interface level
        identityRegistry = await ethers.getContractAt(
            "IIdentityRegistry",
            await identityRegistryProxy.getAddress()
        );
    });

    it("should get agentId for an address from the interface", async function () {
        const agentId = await identityRegistry.addressToAgentId(owner.address);
        expect(agentId).to.equal(0); // Initially 0
    });
});
