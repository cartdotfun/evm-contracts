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

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Request validation for an agent's work
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
     * @dev Respond to a validation request
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
}
