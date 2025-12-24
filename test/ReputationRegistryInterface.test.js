
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationRegistry Interface Completeness", function () {
    let reputationRegistry;
    let owner;
    let identityRegistry;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy IdentityRegistry
        const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
        identityRegistry = await IdentityRegistry.deploy(owner.address);
        await identityRegistry.waitForDeployment();

        // Deploy ReputationRegistry
        const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
        const reputationRegistryContract = await ReputationRegistry.deploy(await identityRegistry.getAddress(), owner.address);
        await reputationRegistryContract.waitForDeployment();
        
        // Get contract instance at the interface level
        reputationRegistry = await ethers.getContractAt("IReputationRegistry", await reputationRegistryContract.getAddress());
    });

    it("should get identityRegistry address from the interface", async function () {
        const identityRegistryAddress = await reputationRegistry.identityRegistry();
        expect(identityRegistryAddress).to.equal(await identityRegistry.getAddress());
    });
});
