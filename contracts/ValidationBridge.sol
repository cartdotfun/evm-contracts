// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IValidationBridge.sol";

/**
 * @title ValidationBridge
 * @dev ERC-8004 compliant Validation Registry Bridge
 *
 * Bridges TrustEngine deals to ERC-8004 validation pattern.
 * Enables validators to record validation results on-chain,
 * with optional automatic fund release based on validation score.
 */
contract ValidationBridge is Ownable, IValidationBridge {
    // Reference to TrustEngine
    address public trustEngine;

    // Reference to IdentityRegistry
    address public identityRegistry;

    // Authorized validators (arbiter addresses)
    mapping(address => bool) public authorizedValidators;

    // requestHash => ValidationRequest
    mapping(bytes32 => ValidationRequest) public validationRequests;

    // requestHash => ValidationResponse (latest)
    mapping(bytes32 => ValidationResponse) public validationResponses;

    // dealId => requestHash (for lookup)
    mapping(bytes32 => bytes32) public dealToRequestHash;

    // agentId => list of request hashes
    mapping(uint256 => bytes32[]) public agentValidationRequests;

    // ERC-8004: validatorAddress => list of request hashes
    mapping(address => bytes32[]) public validatorRequests;

    constructor(
        address _trustEngine,
        address _identityRegistry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        trustEngine = _trustEngine;
        identityRegistry = _identityRegistry;
    }

    /**
     * @dev Get the identity registry address (ERC-8004 required)
     */
    function getIdentityRegistry() external view returns (address) {
        return identityRegistry;
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
            requester: msg.sender,
            validatorAddress: address(0)
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

    /**
     * @dev Get all validation requests for a validator (ERC-8004)
     * @param validatorAddr The validator address to query
     */
    function getValidatorRequests(
        address validatorAddr
    ) external view returns (bytes32[] memory) {
        return validatorRequests[validatorAddr];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Compliant Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Request validation (ERC-8004 compliant)
     * Must be called by owner or operator of agentId
     * @param validatorAddr Target validator address
     * @param agentId Agent ID being validated
     * @param requestUri Points to off-chain data for validation
     * @param requestHash Commitment hash (optional for IPFS)
     */
    function validationRequest(
        address validatorAddr,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external {
        require(bytes(requestUri).length > 0, "Request URI required");

        // Generate request hash if not provided
        bytes32 finalHash = requestHash;
        if (finalHash == bytes32(0)) {
            finalHash = keccak256(
                abi.encodePacked(
                    validatorAddr,
                    agentId,
                    requestUri,
                    block.timestamp
                )
            );
        }

        require(
            validationRequests[finalHash].requestedAt == 0,
            "Request exists"
        );

        validationRequests[finalHash] = ValidationRequest({
            dealId: bytes32(0),
            agentId: agentId,
            requestUri: requestUri,
            requestHash: finalHash,
            requestedAt: block.timestamp,
            requester: msg.sender,
            validatorAddress: validatorAddr
        });

        agentValidationRequests[agentId].push(finalHash);
        validatorRequests[validatorAddr].push(finalHash);

        emit ValidationRequestEvent(
            validatorAddr,
            agentId,
            requestUri,
            finalHash
        );
    }

    /**
     * @dev Respond to validation request (ERC-8004 compliant)
     * Must be called by the validatorAddress specified in original request
     * @param requestHash The request hash to respond to
     * @param response Validation response 0-100
     * @param responseUri Points to validation evidence (optional)
     * @param responseHash Commitment hash for responseUri (optional)
     * @param tag Custom categorization tag (optional)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external {
        ValidationRequest storage request = validationRequests[requestHash];
        require(request.requestedAt > 0, "Request not found");
        require(
            request.validatorAddress == msg.sender ||
                authorizedValidators[msg.sender],
            "Not authorized"
        );
        require(response <= 100, "Response must be 0-100");

        validationResponses[requestHash] = ValidationResponse({
            score: response,
            responseUri: responseUri,
            responseHash: responseHash,
            tag: tag,
            respondedAt: block.timestamp,
            validator: msg.sender
        });

        emit ValidationResponseEvent(
            msg.sender,
            request.agentId,
            requestHash,
            response,
            responseUri,
            tag
        );
    }

    /**
     * @dev Get aggregated validation summary for an agent (ERC-8004)
     * @param agentId Agent ID to query
     * @param validatorAddresses Filter by validators (empty = all)
     * @param tag Filter by tag (bytes32(0) = all)
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        bytes32 tag
    ) external view returns (uint64 count, uint8 avgResponse) {
        bytes32[] storage hashes = agentValidationRequests[agentId];
        uint256 totalScore = 0;
        uint64 validCount = 0;

        for (uint256 i = 0; i < hashes.length; i++) {
            ValidationResponse storage resp = validationResponses[hashes[i]];
            if (resp.respondedAt == 0) continue;

            // Filter by tag if provided
            if (tag != bytes32(0) && resp.tag != tag) continue;

            // Filter by validators if provided
            if (validatorAddresses.length > 0) {
                bool found = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (resp.validator == validatorAddresses[j]) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }

            totalScore += resp.score;
            validCount++;
        }

        count = validCount;
        avgResponse = validCount > 0 ? uint8(totalScore / validCount) : 0;
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
