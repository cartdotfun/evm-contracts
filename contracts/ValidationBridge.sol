// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ValidationBridge
 * @dev ERC-8004 compliant Validation Registry Bridge
 *
 * Bridges TrustEngine deals to ERC-8004 validation pattern.
 * Enables AI arbiters to record validation results on-chain,
 * with optional automatic fund release based on validation score.
 */
contract ValidationBridge is Ownable {
    // Reference to TrustEngine
    address public trustEngine;

    // Reference to IdentityRegistry
    address public identityRegistry;

    // Authorized validators (arbiter addresses)
    mapping(address => bool) public authorizedValidators;

    // Validation request record
    struct ValidationRequest {
        bytes32 dealId;
        uint256 agentId; // Agent being validated
        string requestUri; // Points to inputs/outputs needed for verification
        bytes32 requestHash; // Commitment hash
        uint256 requestedAt;
        address requester;
    }

    // Validation response record
    struct ValidationResponse {
        uint8 score; // 0-100 (0 = failed, 100 = passed)
        string responseUri; // Points to validation evidence/audit
        bytes32 responseHash; // Commitment hash
        bytes32 tag; // Custom categorization (e.g., "soft_finality", "hard_finality")
        uint256 respondedAt;
        address validator;
    }

    // requestHash => ValidationRequest
    mapping(bytes32 => ValidationRequest) public validationRequests;

    // requestHash => ValidationResponse (latest)
    mapping(bytes32 => ValidationResponse) public validationResponses;

    // dealId => requestHash (for lookup)
    mapping(bytes32 => bytes32) public dealToRequestHash;

    // agentId => list of request hashes
    mapping(uint256 => bytes32[]) public agentValidationRequests;

    // Events per ERC-8004 spec
    event ValidationRequested(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        string requestUri,
        bytes32 dealId
    );

    event ValidationResponded(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 score,
        string responseUri,
        bytes32 tag
    );

    event ConditionalReleaseTriggered(
        bytes32 indexed dealId,
        bytes32 indexed requestHash,
        uint8 score,
        uint8 threshold
    );

    event ValidatorAuthorized(address indexed validator);
    event ValidatorRevoked(address indexed validator);

    constructor(
        address _trustEngine,
        address _identityRegistry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        trustEngine = _trustEngine;
        identityRegistry = _identityRegistry;
    }

    /**
     * @dev Request validation for a deal
     * Called when work is submitted to TrustEngine
     * @param dealId The deal ID from TrustEngine
     * @param agentId The agent ID being validated
     * @param requestUri Points to off-chain data for validation
     * @param requestHash Commitment hash of request data
     */
    function requestValidation(
        bytes32 dealId,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external {
        require(bytes(requestUri).length > 0, "Request URI required");

        // Generate request hash if not provided
        bytes32 finalRequestHash = requestHash;
        if (finalRequestHash == bytes32(0)) {
            finalRequestHash = keccak256(
                abi.encodePacked(dealId, agentId, requestUri, block.timestamp)
            );
        }

        require(
            validationRequests[finalRequestHash].requestedAt == 0,
            "Request already exists"
        );

        validationRequests[finalRequestHash] = ValidationRequest({
            dealId: dealId,
            agentId: agentId,
            requestUri: requestUri,
            requestHash: finalRequestHash,
            requestedAt: block.timestamp,
            requester: msg.sender
        });

        dealToRequestHash[dealId] = finalRequestHash;
        agentValidationRequests[agentId].push(finalRequestHash);

        // Emit event with address(0) as validator since it's not yet assigned
        emit ValidationRequested(
            address(0),
            agentId,
            finalRequestHash,
            requestUri,
            dealId
        );
    }

    /**
     * @dev Record validation response
     * Called by authorized validators (AI arbiters)
     * @param requestHash The request hash to respond to
     * @param score Validation score 0-100
     * @param responseUri Points to validation evidence
     * @param responseHash Commitment hash of response data
     * @param tag Custom categorization tag
     */
    function recordValidation(
        bytes32 requestHash,
        uint8 score,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external {
        require(authorizedValidators[msg.sender], "Not authorized validator");
        require(
            validationRequests[requestHash].requestedAt > 0,
            "Request not found"
        );
        require(score <= 100, "Score must be 0-100");

        ValidationRequest storage request = validationRequests[requestHash];

        validationResponses[requestHash] = ValidationResponse({
            score: score,
            responseUri: responseUri,
            responseHash: responseHash,
            tag: tag,
            respondedAt: block.timestamp,
            validator: msg.sender
        });

        emit ValidationResponded(
            msg.sender,
            request.agentId,
            requestHash,
            score,
            responseUri,
            tag
        );
    }

    /**
     * @dev Execute conditional release on TrustEngine
     * Releases funds if validation score meets threshold
     * @param dealId The deal ID to potentially release
     * @param threshold Minimum score required for release (e.g., 80)
     */
    function executeConditionalRelease(
        bytes32 dealId,
        uint8 threshold
    ) external {
        bytes32 requestHash = dealToRequestHash[dealId];
        require(requestHash != bytes32(0), "No validation request for deal");

        ValidationResponse storage response = validationResponses[requestHash];
        require(response.respondedAt > 0, "No validation response yet");

        if (response.score >= threshold) {
            // Call TrustEngine.release(dealId)
            // The ValidationBridge must be authorized on TrustEngine
            (bool success, ) = trustEngine.call(
                abi.encodeWithSignature("release(bytes32)", dealId)
            );
            require(success, "Release failed");

            emit ConditionalReleaseTriggered(
                dealId,
                requestHash,
                response.score,
                threshold
            );
        }
    }

    /**
     * @dev Get validation status for a request
     * @param requestHash The request hash to query
     */
    function getValidationStatus(
        bytes32 requestHash
    )
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 score,
            bytes32 tag,
            uint256 lastUpdate
        )
    {
        ValidationRequest storage request = validationRequests[requestHash];
        ValidationResponse storage response = validationResponses[requestHash];

        validatorAddress = response.validator;
        agentId = request.agentId;
        score = response.score;
        tag = response.tag;
        lastUpdate = response.respondedAt > 0
            ? response.respondedAt
            : request.requestedAt;
    }

    /**
     * @dev Get validation status by deal ID
     * @param dealId The deal ID to query
     */
    function getValidationStatusByDeal(
        bytes32 dealId
    )
        external
        view
        returns (
            bytes32 requestHash,
            uint8 score,
            bool hasResponse,
            uint256 respondedAt
        )
    {
        requestHash = dealToRequestHash[dealId];
        if (requestHash != bytes32(0)) {
            ValidationResponse storage response = validationResponses[
                requestHash
            ];
            score = response.score;
            hasResponse = response.respondedAt > 0;
            respondedAt = response.respondedAt;
        }
    }

    /**
     * @dev Get all validation requests for an agent
     * @param agentId The agent ID to query
     */
    function getAgentValidations(
        uint256 agentId
    ) external view returns (bytes32[] memory) {
        return agentValidationRequests[agentId];
    }

    // Admin functions

    /**
     * @dev Authorize a validator address
     */
    function authorizeValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = true;
        emit ValidatorAuthorized(validator);
    }

    /**
     * @dev Revoke validator authorization
     */
    function revokeValidator(address validator) external onlyOwner {
        authorizedValidators[validator] = false;
        emit ValidatorRevoked(validator);
    }

    /**
     * @dev Update TrustEngine address
     */
    function setTrustEngine(address _trustEngine) external onlyOwner {
        trustEngine = _trustEngine;
    }

    /**
     * @dev Update IdentityRegistry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }
}
