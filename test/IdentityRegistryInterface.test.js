
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IdentityRegistry Interface Completeness", function () {
    let identityRegistry;
    let owner;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy IdentityRegistry
        const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
        const identityRegistryContract = await IdentityRegistry.deploy(owner.address);
        await identityRegistryContract.waitForDeployment();
        
        // Get contract instance at the interface level
        identityRegistry = await ethers.getContractAt("IIdentityRegistry", await identityRegistryContract.getAddress());
    });

    it("should get agentId for an address from the interface", async function () {
        const agentId = await identityRegistry.addressToAgentId(owner.address);
        expect(agentId).to.equal(0); // Initially 0
    });
});
