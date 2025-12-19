// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGatewaySession
 * @dev Interface for GatewaySession - Manages x402-style payment sessions.
 */
interface IGatewaySession {
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
}
