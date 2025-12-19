// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITrustEngine
 * @dev Interface for TrustEngine - The Singleton Vault for M2M Economy.
 */
interface ITrustEngine {
    // ═══════════════════════════════════════════════════════════════════════
    // Data Structures
    // ═══════════════════════════════════════════════════════════════════════

    enum DealState {
        NONE,
        LOCKED,
        VERIFYING,
        DISPUTE,
        COMPLETED,
        REFUNDED
    }

    struct Deal {
        address buyer;
        address seller;
        address token;
        uint256 amount;
        DealState state;
        string resultHash;
        string judgmentCid;
        uint256 createdAt;
        uint256 expiresAt; // Time-lock for release (0 = no time-lock)
        bytes metadata; // Flexible JSON-encoded deal-specific data
        bytes32 parentDealId; // Parent deal (0x0 if root)
        bytes32[] childDealIds; // Sub-deals spawned from this deal
    }

    struct SessionInfo {
        address agent;
        address provider;
        address token;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    function setArbiter(address _arbiter) external;

    function setSolanaRelay(address _relay) external;

    function setSolanaSessionToken(address _token) external;

    function setValidationBridge(address _validationBridge) external;

    function setProtocolFee(uint256 _newFeeBps) external;

    function setProtocolFeeRecipient(address _newRecipient) external;

    function setArbitrationFee(uint256 _newFeeBps) external;

    function setArbitrationFeeRecipient(address _newRecipient) external;

    function setGatewaySession(address _gatewaySession) external;

    // ═══════════════════════════════════════════════════════════════════════
    // Core Vault Functions
    // ═══════════════════════════════════════════════════════════════════════

    function deposit(address _token, uint256 _amount) external payable;

    function withdraw(address _token, uint256 _amount) external;

    function balances(
        address user,
        address token
    ) external view returns (uint256);

    // ═══════════════════════════════════════════════════════════════════════
    // Deal Lifecycle Functions
    // ═══════════════════════════════════════════════════════════════════════

    function createDeal(
        bytes32 _dealId,
        address _seller,
        address _token,
        uint256 _amount,
        bytes calldata _metadata,
        bytes32 _parentDealId,
        uint256 _expiresAt
    ) external;

    function submitWork(bytes32 _dealId, string calldata _resultHash) external;

    function raiseDispute(bytes32 _dealId) external;

    function resolveDispute(
        bytes32 _dealId,
        bool _releaseToSeller,
        string calldata _judgmentCid
    ) external;

    function release(bytes32 _dealId) external;

    function refund(bytes32 _dealId) external;

    function getDealChildren(
        bytes32 _dealId
    ) external view returns (bytes32[] memory);

    function hasParent(bytes32 _dealId) external view returns (bool);

    function getDealMetadata(
        bytes32 _dealId
    ) external view returns (bytes memory);

    function deals(
        bytes32 dealId
    )
        external
        view
        returns (
            address buyer,
            address seller,
            address token,
            uint256 amount,
            DealState state,
            string memory resultHash,
            string memory judgmentCid,
            uint256 createdAt,
            uint256 expiresAt,
            bytes memory metadata,
            bytes32 parentDealId
        );

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Session Functions
    // ═══════════════════════════════════════════════════════════════════════

    function lockForSession(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        address _token,
        uint256 _amount
    ) external;

    function unlockSession(bytes32 _sessionId, uint256 _usedAmount) external;

    function getSessionInfo(
        bytes32 _sessionId
    )
        external
        view
        returns (
            uint256 lockedAmount,
            address agent,
            address provider,
            address token
        );

    function sessionLocks(bytes32 sessionId) external view returns (uint256);

    // ═══════════════════════════════════════════════════════════════════════
    // Cross-Chain Settlement
    // ═══════════════════════════════════════════════════════════════════════

    function settleFromSolana(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        uint256 _amount
    ) external;
}
