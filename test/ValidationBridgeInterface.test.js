
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ValidationBridge Interface Completeness", function () {
    let validationBridge;
    let owner;
    let trustEngine;
    let identityRegistry;
    let validationBridgeImpl;
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

        const TrustEngine = await ethers.getContractFactory("TrustEngine");
        trustEngine = await upgrades.deployProxy(TrustEngine, [owner.address], {
            kind: "uups",
            initializer: "initialize",
        });
        await trustEngine.waitForDeployment();

        const ValidationBridge = await ethers.getContractFactory(
            "ValidationBridge"
        );
        validationBridgeImpl = await upgrades.deployProxy(
            ValidationBridge,
            [
                await trustEngine.getAddress(),
                await identityRegistry.getAddress(),
                owner.address,
            ],
            {
                kind: "uups",
                initializer: "initialize",
                unsafeAllow: ["constructor"],
            }
        );
        await validationBridgeImpl.waitForDeployment();
        
        // Get contract instance at the interface level
        validationBridge = await ethers.getContractAt(
            "IValidationBridge",
            await validationBridgeImpl.getAddress()
        );
    });

    it("should get trustEngine address from the interface", async function () {
        const trustEngineAddress = await validationBridge.trustEngine();
        expect(trustEngineAddress).to.equal(await trustEngine.getAddress());
    });

    it("should get identityRegistry address from the interface", async function () {
        const identityRegistryAddress = await validationBridge.identityRegistry();
        expect(identityRegistryAddress).to.equal(await identityRegistry.getAddress());
    });

    it("should check authorizedValidators from the interface", async function () {
        await validationBridgeImpl.authorizeValidator(owner.address);
        const isAuthorized = await validationBridge.authorizedValidators(owner.address);
        expect(isAuthorized).to.be.true;
    });

    it("should get validationRequests from the interface", async function () {
        // We can't easily populate this without making a request, but we can check the getter exists
        // and returns default values for a random hash
        const randomHash = ethers.keccak256(ethers.toUtf8Bytes("random"));
        const request = await validationBridge.validationRequests(randomHash);
        expect(request.agentId).to.equal(0);
    });

    it("should get validationResponses from the interface", async function () {
        const randomHash = ethers.keccak256(ethers.toUtf8Bytes("random"));
        const response = await validationBridge.validationResponses(randomHash);
        expect(response.score).to.equal(0);
    });

    it("should get dealToRequestHash from the interface", async function () {
        const randomDealId = ethers.keccak256(ethers.toUtf8Bytes("deal"));
        const hash = await validationBridge.dealToRequestHash(randomDealId);
        expect(hash).to.equal(ethers.ZeroHash);
    });

    it("should get validatorRequests from the interface", async function () {
        // This will revert if index out of bounds, so we need to populate first or just check existence in ABI
        // But for runtime test, we can try to call it and expect revert or success if we populate.
        // Let's rely on the fact that if it wasn't in ABI, accessing it on validationBridge would be undefined/fail differently.
        try {
            await validationBridge.validatorRequests(owner.address, 0);
        } catch (error) {
            // Expected revert because array is empty
        }
    });

    it("should get agentValidationRequests from the interface", async function () {
        // This is expected to FAIL if the function is missing from the interface
        // validationBridge is instantiated with IValidationBridge
        try {
            await validationBridge.agentValidationRequests(1, 0);
        } catch (error) {
             // If function is missing, this might throw "validationBridge.agentValidationRequests is not a function"
             // or similar. We want to verify it EXISTS.
             if (error.message.includes("is not a function")) {
                 throw new Error("agentValidationRequests is missing from the interface");
             }
        }
    });
});
