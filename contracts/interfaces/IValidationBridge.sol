// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IValidationBridge
 * @dev ERC-8004 Validation Registry Interface
 *
 * Provides a standardized interface for requesting and recording validation
 * results for AI agent outputs. Validators assess agent work and record scores.
 */
interface IValidationBridge {
    // ═══════════════════════════════════════════════════════════════════════
    // Structs
    // ═══════════════════════════════════════════════════════════════════════

    struct ValidationRequest {
        bytes32 dealId;
        uint256 agentId; // Agent being validated
        string requestUri; // Points to inputs/outputs needed for verification
        bytes32 requestHash; // Commitment hash
        uint256 requestedAt;
        address requester;
        address validatorAddress; // Target validator
    }

    struct ValidationResponse {
        uint8 score; // 0-100 (0 = failed, 100 = passed)
        string responseUri; // Points to validation evidence/audit
        bytes32 responseHash; // Commitment hash
        bytes32 tag; // Custom categorization (e.g., "soft_finality", "hard_finality")
        uint256 respondedAt;
        address validator;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════

    event ValidationRequestEvent(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestUri,
        bytes32 indexed requestHash
    );

    event ValidationResponseEvent(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseUri,
        bytes32 tag
    );

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

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Request validation for a deal
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
    ) external;

    /**
     * @dev Record validation response
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
    ) external;

    /**
     * @dev Execute conditional release on TrustEngine
     * @param dealId The deal ID to potentially release
     * @param threshold Minimum score required for release
     */
    function executeConditionalRelease(
        bytes32 dealId,
        uint8 threshold
    ) external;

    /**
     * @dev Request validation for an agent's work (ERC-8004 compliant)
     * @param validatorAddress Target validator address
     * @param agentId Agent ID being validated
     * @param requestUri URI pointing to data for validation
     * @param requestHash Commitment hash (optional for IPFS)
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external;

    /**
     * @dev Respond to a validation request (ERC-8004 compliant)
     * @param requestHash The request hash to respond to
     * @param response Validation response 0-100
     * @param responseUri URI pointing to validation evidence
     * @param responseHash Commitment hash for responseUri
     * @param tag Custom categorization tag
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    // Read Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Get the identity registry address
     */
    function getIdentityRegistry() external view returns (address);

    /**
     * @dev Get all validation requests for an agent
     * @param agentId The agent ID to query
     */
    function getAgentValidations(
        uint256 agentId
    ) external view returns (bytes32[] memory);

    /**
     * @dev Get all validation requests for a validator
     * @param validatorAddress The validator address to query
     */
    function getValidatorRequests(
        address validatorAddress
    ) external view returns (bytes32[] memory);

    /**
     * @dev Get aggregated validation summary for an agent
     * @param agentId Agent ID to query
     * @param validatorAddresses Filter by validators (empty = all)
     * @param tag Filter by tag (bytes32(0) = all)
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        bytes32 tag
    ) external view returns (uint64 count, uint8 avgResponse);

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
        );

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
        );

    function trustEngine() external view returns (address);

    function identityRegistry() external view returns (address);

    function authorizedValidators(address validator) external view returns (bool);

    function validationRequests(bytes32 requestHash) external view returns (
        bytes32 dealId,
        uint256 agentId,
        string memory requestUri,
        bytes32 requestHashReturn,
        uint256 requestedAt,
        address requester,
        address validatorAddress
    );

    function validationResponses(bytes32 requestHash) external view returns (
        uint8 score,
        string memory responseUri,
        bytes32 responseHash,
        bytes32 tag,
        uint256 respondedAt,
        address validator
    );

    function dealToRequestHash(bytes32 dealId) external view returns (bytes32);

    function agentValidationRequests(uint256 agentId, uint256 index) external view returns (bytes32);

    function validatorRequests(address validator, uint256 index) external view returns (bytes32);

    // Admin functions

    function authorizeValidator(address validator) external;

    function revokeValidator(address validator) external;

    function setTrustEngine(address _trustEngine) external;

    function setIdentityRegistry(address _identityRegistry) external;
}
