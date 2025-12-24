// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk
// @author: Opus 4.5
// @contact: lloydfaulk@gmail.com
// @version: 1.0.0

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITrustEngine.sol";

/**
 * @title TrustEngine
 * @dev Singleton Vault for M2M Economy. Handles internal accounting and atomic deals.
 */
contract TrustEngine is ReentrancyGuard, Ownable, ITrustEngine {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    // State Variables
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MAX_CHILD_DEALS = 10;
    uint256 public constant MAX_METADATA_SIZE = 1024; // 1KB

    mapping(address => mapping(address => uint256)) public override balances;
    mapping(bytes32 => Deal) public override deals;
    mapping(bytes32 => uint256) public override sessionLocks;
    mapping(bytes32 => SessionInfo) public sessionInfo;
    mapping(bytes32 => bool) public processedSolanaSettlements;

    address public arbiter;
    address public protocolFeeRecipient;
    uint256 public protocolFeeBps;
    address public arbitrationFeeRecipient;
    uint256 public arbitrationFeeBps;
    address public validationBridge;
    address public gatewaySession;
    address public solanaRelay;
    address public solanaSessionToken;

    // ═══════════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Sets the arbiter address.
     * @param _arbiter The new arbiter address.
     */
    function setArbiter(address _arbiter) external onlyOwner {
        arbiter = _arbiter;
        emit ArbiterUpdated(_arbiter);
    }

    /**
     * @dev Set authorized Solana relay address.
     * @param _relay Address authorized to submit Solana settlements.
     */
    function setSolanaRelay(address _relay) external onlyOwner {
        if (_relay == address(0)) revert InvalidAddress();
        solanaRelay = _relay;
        emit SolanaRelayUpdated(_relay);
    }

    /**
     * @dev Set token used for Solana sessions.
     * @param _token Token address (typically USDC).
     */
    function setSolanaSessionToken(address _token) external onlyOwner {
        solanaSessionToken = _token;
        emit SolanaSessionTokenUpdated(_token);
    }

    /**
     * @dev Set ERC-8004 ValidationBridge address.
     * @param _validationBridge Address of the ValidationBridge contract.
     */
    function setValidationBridge(address _validationBridge) external onlyOwner {
        validationBridge = _validationBridge;
        emit ValidationBridgeUpdated(_validationBridge);
    }

    /**
     * @dev Update protocol fee.
     * @param _newFeeBps New fee in basis points (10 = 0.1%, 100 = 1%).
     */
    function setProtocolFee(uint256 _newFeeBps) external onlyOwner {
        if (_newFeeBps > 1000) revert FeeTooHigh();
        uint256 oldFeeBps = protocolFeeBps;
        protocolFeeBps = _newFeeBps;
        emit ProtocolFeeUpdated(oldFeeBps, _newFeeBps);
    }

    /**
     * @dev Update protocol fee recipient.
     * @param _newRecipient The new recipient address.
     */
    function setProtocolFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert InvalidAddress();
        address oldRecipient = protocolFeeRecipient;
        protocolFeeRecipient = _newRecipient;
        emit ProtocolFeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    /**
     * @dev Update arbitration fee.
     * @param _newFeeBps New fee in basis points (300 = 3%).
     */
    function setArbitrationFee(uint256 _newFeeBps) external onlyOwner {
        if (_newFeeBps > 1000) revert FeeTooHigh();
        uint256 oldFeeBps = arbitrationFeeBps;
        arbitrationFeeBps = _newFeeBps;
        emit ArbitrationFeeUpdated(oldFeeBps, _newFeeBps);
    }

    /**
     * @dev Update arbitration fee recipient.
     * @param _newRecipient The new recipient address.
     */
    function setArbitrationFeeRecipient(
        address _newRecipient
    ) external onlyOwner {
        if (_newRecipient == address(0)) revert InvalidAddress();
        address oldRecipient = arbitrationFeeRecipient;
        arbitrationFeeRecipient = _newRecipient;
        emit ArbitrationFeeRecipientUpdated(oldRecipient, _newRecipient);
    }
    
    /**
     * @dev Set the authorized GatewaySession contract address.
     * @param _gatewaySession Address of the GatewaySession contract.
     */
    function setGatewaySession(address _gatewaySession) external onlyOwner {
        gatewaySession = _gatewaySession;
        emit GatewaySessionUpdated(_gatewaySession);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Core Vault Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Deposit assets into internal balance.
     * @param _token Token address (use address(0) for ETH).
     * @param _amount Amount to deposit.
     */
    function deposit(
        address _token,
        uint256 _amount
    ) external payable nonReentrant {
        if (_amount == 0) revert InvalidAmount();

        if (_token == address(0)) {
            if (msg.value != _amount) revert EthMismatch();
        } else {
            if (msg.value != 0) revert NoEthForERC20();
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        }

        balances[msg.sender][_token] += _amount;
        emit Deposited(msg.sender, _token, _amount);
    }

    /**
     * @dev Withdraw assets from internal balance to wallet.
     * @param _token Token address (use address(0) for ETH).
     * @param _amount Amount to withdraw.
     */
    function withdraw(address _token, uint256 _amount) external nonReentrant {
        if (balances[msg.sender][_token] < _amount)
            revert InsufficientBalance();

        balances[msg.sender][_token] -= _amount;

        if (_token == address(0)) {
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            if (!sent) revert EthTransferFailed();
        } else {
            IERC20(_token).safeTransfer(msg.sender, _amount);
        }

        emit Withdrawn(msg.sender, _token, _amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Deal Lifecycle Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Create a deal by locking internal funds.
     * @param _dealId Unique identifier for the deal.
     * @param _seller Seller address.
     * @param _token Token address.
     * @param _amount Amount to lock.
     * @param _metadata Flexible JSON-encoded deal data (empty bytes for simple deals).
     * @param _parentDealId Parent deal ID (0x0 for root deals).
     * @param _expiresAt Time-lock release timestamp (0 for no time-lock).
     */
    function createDeal(
        bytes32 _dealId,
        address _seller,
        address _token,
        uint256 _amount,
        bytes calldata _metadata,
        bytes32 _parentDealId,
        uint256 _expiresAt
    ) external nonReentrant {
        if (deals[_dealId].state != DealState.NONE) revert DealAlreadyExists();
        if (balances[msg.sender][_token] < _amount)
            revert InsufficientBalance();
        if (_amount == 0) revert InvalidAmount();
        if (_seller == address(0)) revert InvalidAddress();
        if (_metadata.length > MAX_METADATA_SIZE) revert MetadataTooLarge();

        if (_parentDealId != bytes32(0)) {
            if (deals[_parentDealId].state == DealState.NONE)
                revert DealNotFound();
            if (deals[_parentDealId].buyer != msg.sender) revert Unauthorized();
            if (deals[_parentDealId].childDealIds.length >= MAX_CHILD_DEALS)
                revert MaxChildDealsReached();
        }

        if (_expiresAt > 0) {
            if (_expiresAt <= block.timestamp) revert ExpiryMustBeFuture();
        }

        balances[msg.sender][_token] -= _amount;

        bytes32[] memory emptyChildren;

        deals[_dealId] = Deal({
            buyer: msg.sender,
            seller: _seller,
            token: _token,
            amount: _amount,
            state: DealState.LOCKED,
            resultHash: "",
            judgmentCid: "",
            createdAt: block.timestamp,
            metadata: _metadata,
            parentDealId: _parentDealId,
            childDealIds: emptyChildren,
            expiresAt: _expiresAt
        });

        if (_parentDealId != bytes32(0)) {
            deals[_parentDealId].childDealIds.push(_dealId);
            emit ChildDealCreated(_parentDealId, _dealId, _seller, _amount);
        }

        emit DealCreated(
            _dealId,
            msg.sender,
            _seller,
            _token,
            _amount,
            _parentDealId,
            _expiresAt
        );
    }

    /**
     * @dev Submit work (IPFS hash) for verification.
     * @param _dealId Deal identifier.
     * @param _resultHash IPFS hash or link to work.
     */
    function submitWork(
        bytes32 _dealId,
        string calldata _resultHash
    ) external nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.state != DealState.LOCKED) revert InvalidDealState();
        if (msg.sender != deal.seller) revert Unauthorized();

        deal.resultHash = _resultHash;
        deal.state = DealState.VERIFYING;

        emit WorkSubmitted(_dealId, msg.sender, _resultHash);
    }

    /**
     * @dev Raise a dispute.
     * @param _dealId Deal identifier.
     */
    function raiseDispute(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.state != DealState.LOCKED && deal.state != DealState.VERIFYING)
            revert InvalidDealState();
        if (msg.sender != deal.buyer && msg.sender != deal.seller)
            revert Unauthorized();

        deal.state = DealState.DISPUTE;
        emit DisputeRaised(_dealId, msg.sender);
    }

    /**
     * @dev Resolve a dispute.
     * @param _dealId Deal identifier.
     * @param _releaseToSeller True to release to seller, False to refund buyer.
     * @param _judgmentCid IPFS CID of the judgment.
     */
    function resolveDispute(
        bytes32 _dealId,
        bool _releaseToSeller,
        string calldata _judgmentCid
    ) external nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.state != DealState.DISPUTE) revert InvalidDealState();
        if (msg.sender != arbiter) revert Unauthorized();

        deal.judgmentCid = _judgmentCid;

        if (_releaseToSeller) {
            deal.state = DealState.COMPLETED;
            _distributeWithFee(_dealId, deal.seller, deal.token, deal.amount);
            emit DealReleased(_dealId, deal.seller, deal.amount);
            emit DisputeResolved(_dealId, DealState.COMPLETED, _judgmentCid);
        } else {
            deal.state = DealState.REFUNDED;
            balances[deal.buyer][deal.token] += deal.amount;
            emit DealRefunded(_dealId, deal.buyer, deal.amount);
            emit DisputeResolved(_dealId, DealState.REFUNDED, _judgmentCid);
        }
    }

    /**
     * @dev Release funds to seller.
     * @param _dealId Deal identifier.
     */
    function release(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.state != DealState.LOCKED && deal.state != DealState.VERIFYING)
            revert InvalidDealState();
        if (
            msg.sender != deal.buyer &&
            msg.sender != arbiter &&
            msg.sender != validationBridge
        ) revert Unauthorized();

        if (deal.expiresAt > 0) {
            if (block.timestamp < deal.expiresAt) revert DealTimeLocked();
        }

        deal.state = DealState.COMPLETED;

        _distributeWithFee(_dealId, deal.seller, deal.token, deal.amount);

        emit DealReleased(_dealId, deal.seller, deal.amount);
    }

    /**
     * @dev Refund funds to buyer.
     * @param _dealId Deal identifier.
     */
    function refund(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.state != DealState.LOCKED && deal.state != DealState.VERIFYING)
            revert InvalidDealState();
        if (msg.sender != deal.seller) revert Unauthorized();

        deal.state = DealState.REFUNDED;

        balances[deal.buyer][deal.token] += deal.amount;

        emit DealRefunded(_dealId, deal.buyer, deal.amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Session Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Lock funds from agent's internal balance for a session.
     * @param _sessionId Unique session identifier.
     * @param _agent Agent whose funds are being locked.
     * @param _provider Service provider who will receive payment.
     * @param _token Token address (use address(0) for ETH).
     * @param _amount Amount to lock.
     */
    function lockForSession(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        address _token,
        uint256 _amount
    ) external nonReentrant {
        if (msg.sender != gatewaySession) revert Unauthorized();
        if (sessionLocks[_sessionId] != 0) revert SessionAlreadyExists();
        if (balances[_agent][_token] < _amount) revert InsufficientBalance();
        if (_amount == 0) revert InvalidAmount();
        if (_provider == address(0)) revert InvalidAddress();

        balances[_agent][_token] -= _amount;

        sessionLocks[_sessionId] = _amount;
        sessionInfo[_sessionId] = SessionInfo({
            agent: _agent,
            provider: _provider,
            token: _token
        });

        emit SessionLocked(_sessionId, _agent, _provider, _token, _amount);
    }

    /**
     * @dev Unlock session funds: distribute used amount to provider, refund remainder to agent.
     * @param _sessionId Session identifier.
     * @param _usedAmount Amount consumed during session (goes to provider).
     */
    function unlockSession(
        bytes32 _sessionId,
        uint256 _usedAmount
    ) external nonReentrant {
        if (msg.sender != gatewaySession) revert Unauthorized();

        uint256 lockedAmount = sessionLocks[_sessionId];
        if (lockedAmount == 0) revert SessionNotFound();
        if (_usedAmount > lockedAmount) revert UsedExceedsLocked();

        SessionInfo memory info = sessionInfo[_sessionId];
        uint256 refundAmount = lockedAmount - _usedAmount;

        sessionLocks[_sessionId] = 0;

        if (_usedAmount > 0) {
            _distributeWithFee(
                _sessionId,
                info.provider,
                info.token,
                _usedAmount
            );
        }

        if (refundAmount > 0) {
            balances[info.agent][info.token] += refundAmount;
        }

        emit SessionUnlocked(_sessionId, _usedAmount, refundAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Cross-Chain Settlement
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @dev Settle a session from Solana.
     * @param _sessionId Unique session identifier from Solana.
     * @param _agent Agent address (EVM).
     * @param _provider Provider address (EVM).
     * @param _amount Amount to transfer from agent to provider.
     */
    function settleFromSolana(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        uint256 _amount
    ) external nonReentrant {
        if (msg.sender != solanaRelay) revert Unauthorized();
        if (processedSolanaSettlements[_sessionId]) revert AlreadyProcessed();
        if (solanaSessionToken == address(0)) revert TokenNotConfigured();
        if (balances[_agent][solanaSessionToken] < _amount)
            revert InsufficientBalance();

        processedSolanaSettlements[_sessionId] = true;

        balances[_agent][solanaSessionToken] -= _amount;
        _distributeWithFee(_sessionId, _provider, solanaSessionToken, _amount);

        emit CrossChainSettlement(_sessionId, _agent, _provider, _amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Get all child deal IDs for a given deal.
     * @param _dealId Deal identifier.
     * @return Array of child deal IDs.
     */
    function getDealChildren(
        bytes32 _dealId
    ) external view returns (bytes32[] memory) {
        return deals[_dealId].childDealIds;
    }

    /**
     * @dev Check if a deal has a parent.
     * @param _dealId Deal identifier.
     * @return True if deal has a parent, false otherwise.
     */
    function hasParent(bytes32 _dealId) external view returns (bool) {
        return deals[_dealId].parentDealId != bytes32(0);
    }

    /**
     * @dev Get deal metadata.
     * @param _dealId Deal identifier.
     * @return Deal metadata bytes.
     */
    function getDealMetadata(
        bytes32 _dealId
    ) external view returns (bytes memory) {
        return deals[_dealId].metadata;
    }

    /**
     * @dev Get session info.
     * @param _sessionId Session identifier.
     * @return lockedAmount The amount locked for this session.
     * @return agent The agent who locked funds.
     * @return provider The service provider.
     * @return token The token used for payment.
     */
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
        )
    {
        SessionInfo memory info = sessionInfo[_sessionId];
        return (
            sessionLocks[_sessionId],
            info.agent,
            info.provider,
            info.token
        );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal helper to distribute funds with protocol fee deduction.
     */
    function _distributeWithFee(
        bytes32 _refId,
        address _to,
        address _token,
        uint256 _amount
    ) internal {
        uint256 fee = 0;
        if (protocolFeeBps > 0 && protocolFeeRecipient != address(0)) {
            fee = (_amount * protocolFeeBps) / 10000;
            balances[protocolFeeRecipient][_token] += fee;
            emit ProtocolFeeCollected(_refId, _token, fee);
        }
        balances[_to][_token] += (_amount - fee);
    }
}

// Custom errors for gas-efficient reverts
error InvalidAddress();
error InvalidAmount();
error InsufficientBalance();
error FeeTooHigh();
error DealAlreadyExists();
error DealNotFound();
error InvalidDealState();
error Unauthorized();
error MetadataTooLarge();
error MaxChildDealsReached();
error ExpiryMustBeFuture();
error DealTimeLocked();
error SessionAlreadyExists();
error SessionNotFound();
error UsedExceedsLocked();
error AlreadyProcessed();
error TokenNotConfigured();
error EthTransferFailed();
error EthMismatch();
error NoEthForERC20();
