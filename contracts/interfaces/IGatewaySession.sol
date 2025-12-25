// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk
// @author: Opus 4.5
// @version: 1.0.0

pragma solidity ^0.8.24;

import "./ITrustEngine.sol";

/**
 * @title IGatewaySession
 * @dev Interface for GatewaySession - Manages x402-style payment sessions.
 */
interface IGatewaySession {
    // ═══════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════

    event TrustEngineUpdated(address indexed newTrustEngine);
    event GatewayRegistered(
        string indexed slug,
        address indexed provider,
        uint256 pricePerRequest
    );
    event GatewayUpdated(string indexed slug, uint256 newPrice);
    event GatewayDeactivated(string indexed slug);

    event SessionOpened(
        bytes32 indexed sessionId,
        address indexed agent,
        address indexed provider,
        string gatewaySlug,
        uint256 depositAmount,
        uint256 expiresAt
    );

    event UsageRecorded(
        bytes32 indexed sessionId,
        uint256 amount,
        uint256 cumulativeUsed
    );

    event SessionSettled(
        bytes32 indexed sessionId,
        uint256 totalUsed,
        uint256 refunded
    );

    event SessionCancelled(bytes32 indexed sessionId, uint256 refunded);
    event SessionRenewed(bytes32 indexed sessionId, uint256 newExpiresAt);

    // ═══════════════════════════════════════════════════════════════════════
    // Data Structures
    // ═══════════════════════════════════════════════════════════════════════

    enum SessionState {
        NONE,
        ACTIVE,
        SETTLED,
        EXPIRED,
        CANCELLED
    }

    struct Session {
        address agent; // Paying agent
        address provider; // Service provider (API owner)
        address token; // Payment token (e.g., USDC)
        uint256 depositAmount; // Initial locked amount
        uint256 usedAmount; // Cumulative usage tracked off-chain, settled on-chain
        uint256 createdAt;
        uint256 expiresAt; // Session timeout
        SessionState state;
        string gatewaySlug; // Identifier for the gateway/API
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    function setTrustEngine(address _trustEngine) external;

    function trustEngine() external view returns (ITrustEngine);

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Registry Functions
    // ═══════════════════════════════════════════════════════════════════════

    function registerGateway(
        string calldata _slug,
        uint256 _pricePerRequest
    ) external;

    function updateGatewayPrice(
        string calldata _slug,
        uint256 _newPrice
    ) external;

    function deactivateGateway(string calldata _slug) external;

    // ═══════════════════════════════════════════════════════════════════════
    // Session Lifecycle Functions
    // ═══════════════════════════════════════════════════════════════════════

    function openSession(
        string calldata _gatewaySlug,
        address _token,
        uint256 _deposit,
        uint256 _duration
    ) external returns (bytes32 sessionId);

    function recordUsage(bytes32 _sessionId, uint256 _amount) external;

    function settleSession(bytes32 _sessionId) external;

    function cancelSession(bytes32 _sessionId) external;

    function renewSession(bytes32 _sessionId, uint256 _extension) external;

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    function getRemainingCredits(
        bytes32 _sessionId
    ) external view returns (uint256);

    function isSessionValid(bytes32 _sessionId) external view returns (bool);

    function getSession(
        bytes32 _sessionId
    )
        external
        view
        returns (
            address agent,
            address provider,
            address token,
            uint256 depositAmount,
            uint256 usedAmount,
            uint256 expiresAt,
            SessionState state,
            string memory gatewaySlug
        );

    function getGateway(
        string calldata _slug
    ) external view returns (address provider, uint256 pricePerRequest);

    function sessions(
        bytes32 sessionId
    )
        external
        view
        returns (
            address agent,
            address provider,
            address token,
            uint256 depositAmount,
            uint256 usedAmount,
            uint256 createdAt,
            uint256 expiresAt,
            SessionState state,
            string memory gatewaySlug
        );

    function gateways(string calldata slug) external view returns (address);

    function gatewayPricing(
        string calldata slug
    ) external view returns (uint256);

    function getActiveSessions(
        address _provider
    ) external view returns (bytes32[] memory);

    function agentNonces(address agent) external view returns (uint256);

    function activeSessionsByProvider(
        address provider
    ) external view returns (uint256);
}
