// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk <hey@cart.fun> & Opus 4.5
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
    // Security Constants
    // ═══════════════════════════════════════════════════════════════════════
    uint256 public constant MAX_CHILD_DEALS = 10;
    uint256 public constant MAX_METADATA_SIZE = 1024; // 1KB

    // Internal Accounting: User -> Token -> Balance
    // address(0) represents Native ETH
    mapping(address => mapping(address => uint256)) public override balances;

    mapping(bytes32 => Deal) public override deals;

    address public arbiter;

    address public protocolFeeRecipient;
    uint256 public protocolFeeBps; // 0 = 0%, 10 = 0.1%, 100 = 1%

    address public arbitrationFeeRecipient;
    uint256 public arbitrationFeeBps; // 300 = 3%

    // ERC-8004 ValidationBridge address (authorized to call release)
    address public validationBridge;

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Session Support (for x402-style batched payments)
    // ═══════════════════════════════════════════════════════════════════════

    // Session lock tracking: sessionId -> locked amount
    mapping(bytes32 => uint256) public override sessionLocks;
    // Session metadata: sessionId -> (agent, provider, token)
    mapping(bytes32 => SessionInfo) public sessionInfo;
    // Authorized GatewaySession contract address
    address public gatewaySession;

    // ═══════════════════════════════════════════════════════════════════════
    // Solana Cross-Chain Settlement Support
    // ═══════════════════════════════════════════════════════════════════════

    // Authorized relay address for Solana → Base settlements
    address public solanaRelay;
    // Track processed Solana settlements to prevent replay
    mapping(bytes32 => bool) public processedSolanaSettlements;
    // Default token for Solana sessions (USDC)
    address public solanaSessionToken;

    event SolanaRelayUpdated(address indexed newRelay);
    event SolanaSessionTokenUpdated(address indexed newToken);
    event CrossChainSettlement(
        bytes32 indexed sessionId,
        address indexed agent,
        address indexed provider,
        uint256 amount
    );

    event ArbiterUpdated(address indexed newArbiter);
    event ProtocolFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event ProtocolFeeRecipientUpdated(
        address oldRecipient,
        address newRecipient
    );
    event ArbitrationFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event ArbitrationFeeRecipientUpdated(
        address oldRecipient,
        address newRecipient
    );
    event ValidationBridgeUpdated(address indexed newBridge);
    event ProtocolFeeCollected(
        bytes32 indexed refId,
        address indexed token,
        uint256 amount
    );

    event Deposited(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event Withdrawn(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event DealCreated(
        bytes32 indexed dealId,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount,
        bytes32 parentDealId,
        uint256 expiresAt
    );
    event DealReleased(
        bytes32 indexed dealId,
        address indexed seller,
        uint256 amount
    );
    event DealRefunded(
        bytes32 indexed dealId,
        address indexed buyer,
        uint256 amount
    );
    event WorkSubmitted(
        bytes32 indexed dealId,
        address indexed seller,
        string resultHash
    );
    event DisputeRaised(bytes32 indexed dealId, address indexed raiser);
    event DisputeResolved(
        bytes32 indexed dealId,
        DealState resolution,
        string judgmentCid
    );
    event ChildDealCreated(
        bytes32 indexed parentDealId,
        bytes32 indexed childDealId,
        address indexed seller,
        uint256 amount
    );
    event GatewaySessionUpdated(address indexed newGatewaySession);
    event SessionLocked(
        bytes32 indexed sessionId,
        address indexed agent,
        address indexed provider,
        address token,
        uint256 amount
    );
    event SessionUnlocked(
        bytes32 indexed sessionId,
        uint256 toProvider,
        uint256 refundedToAgent
    );

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    function setArbiter(address _arbiter) external onlyOwner {
        arbiter = _arbiter;
        emit ArbiterUpdated(_arbiter);
    }

    /**
     * @dev Set authorized Solana relay address (only owner)
     * @param _relay Address authorized to submit Solana settlements
     */
    function setSolanaRelay(address _relay) external onlyOwner {
        require(_relay != address(0), "Invalid relay address");
        solanaRelay = _relay;
        emit SolanaRelayUpdated(_relay);
    }

    /**
     * @dev Set token used for Solana sessions (only owner)
     * @param _token Token address (typically USDC)
     */
    function setSolanaSessionToken(address _token) external onlyOwner {
        solanaSessionToken = _token;
        emit SolanaSessionTokenUpdated(_token);
    }

    /**
     * @dev Settle a session from Solana (called by authorized relay)
     * @param _sessionId Unique session identifier from Solana
     * @param _agent Agent address (EVM)
     * @param _provider Provider address (EVM)
     * @param _amount Amount to transfer from agent to provider
     */
    function settleFromSolana(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        uint256 _amount
    ) external nonReentrant {
        require(msg.sender == solanaRelay, "Only Solana relay");
        require(!processedSolanaSettlements[_sessionId], "Already processed");
        require(solanaSessionToken != address(0), "Token not configured");
        require(
            balances[_agent][solanaSessionToken] >= _amount,
            "Insufficient agent balance"
        );

        // Mark as processed to prevent replay
        processedSolanaSettlements[_sessionId] = true;

        // Transfer from agent balance to provider balance
        balances[_agent][solanaSessionToken] -= _amount;
        _distributeWithFee(_sessionId, _provider, solanaSessionToken, _amount);

        emit CrossChainSettlement(_sessionId, _agent, _provider, _amount);
    }

    /**
     * @dev Set ERC-8004 ValidationBridge address (only owner)
     * @param _validationBridge Address of the ValidationBridge contract
     */
    function setValidationBridge(address _validationBridge) external onlyOwner {
        validationBridge = _validationBridge;
        emit ValidationBridgeUpdated(_validationBridge);
    }

    /**
     * @dev Update protocol fee (only owner)
     * @param _newFeeBps New fee in basis points (10 = 0.1%, 100 = 1%)
     */
    function setProtocolFee(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= 1000, "Fee too high"); // Max 10%
        uint256 oldFeeBps = protocolFeeBps;
        protocolFeeBps = _newFeeBps;
        emit ProtocolFeeUpdated(oldFeeBps, _newFeeBps);
    }

    /**
     * @dev Update protocol fee recipient (only owner)
     */
    function setProtocolFeeRecipient(address _newRecipient) external onlyOwner {
        require(_newRecipient != address(0), "Invalid recipient");
        address oldRecipient = protocolFeeRecipient;
        protocolFeeRecipient = _newRecipient;
        emit ProtocolFeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    /**
     * @dev Update arbitration fee (only owner)
     * @param _newFeeBps New fee in basis points (300 = 3%)
     */
    function setArbitrationFee(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= 1000, "Fee too high"); // Max 10%
        uint256 oldFeeBps = arbitrationFeeBps;
        arbitrationFeeBps = _newFeeBps;
        emit ArbitrationFeeUpdated(oldFeeBps, _newFeeBps);
    }

    /**
     * @dev Update arbitration fee recipient (only owner)
     */
    function setArbitrationFeeRecipient(
        address _newRecipient
    ) external onlyOwner {
        require(_newRecipient != address(0), "Invalid recipient");
        address oldRecipient = arbitrationFeeRecipient;
        arbitrationFeeRecipient = _newRecipient;
        emit ArbitrationFeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    /**
     * @dev Deposit assets into internal balance.
     * @param _token Token address (use address(0) for ETH)
     * @param _amount Amount to deposit
     */
    function deposit(
        address _token,
        uint256 _amount
    ) external payable nonReentrant {
        require(_amount > 0, "Amount must be > 0");

        if (_token == address(0)) {
            require(msg.value == _amount, "ETH amount mismatch");
        } else {
            require(msg.value == 0, "Do not send ETH with ERC20 deposit");
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        }

        balances[msg.sender][_token] += _amount;
        emit Deposited(msg.sender, _token, _amount);
    }

    /**
     * @dev Withdraw assets from internal balance to wallet.
     * @param _token Token address (use address(0) for ETH)
     * @param _amount Amount to withdraw
     */
    function withdraw(address _token, uint256 _amount) external nonReentrant {
        require(
            balances[msg.sender][_token] >= _amount,
            "Insufficient internal balance"
        );

        balances[msg.sender][_token] -= _amount;

        if (_token == address(0)) {
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            require(sent, "ETH transfer failed");
        } else {
            IERC20(_token).safeTransfer(msg.sender, _amount);
        }

        emit Withdrawn(msg.sender, _token, _amount);
    }

    /**
     * @dev Create a deal by locking internal funds.
     * @param _dealId Unique identifier for the deal
     * @param _seller Seller address
     * @param _token Token address
     * @param _amount Amount to lock
     * @param _metadata Flexible JSON-encoded deal data (empty bytes for simple deals)
     * @param _parentDealId Parent deal ID (0x0 for root deals)
     * @param _expiresAt Time-lock release timestamp (0 for no time-lock)
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
        require(deals[_dealId].state == DealState.NONE, "Deal already exists");
        require(
            balances[msg.sender][_token] >= _amount,
            "Insufficient internal balance"
        );
        require(_amount > 0, "Amount must be > 0");
        require(_seller != address(0), "Invalid seller");
        require(_metadata.length <= MAX_METADATA_SIZE, "Metadata too large");

        // If parent specified, validate it exists and is owned by buyer
        if (_parentDealId != bytes32(0)) {
            require(
                deals[_parentDealId].state != DealState.NONE,
                "Parent deal does not exist"
            );
            require(
                deals[_parentDealId].buyer == msg.sender,
                "Not authorized to create child deal"
            );
            require(
                deals[_parentDealId].childDealIds.length < MAX_CHILD_DEALS,
                "Max child deals reached"
            );
        }

        // Validate expiry time if specified
        if (_expiresAt > 0) {
            require(_expiresAt > block.timestamp, "Expiry must be in future");
        }

        // Lock funds (deduct from buyer's internal balance)
        balances[msg.sender][_token] -= _amount;

        // Initialize empty child array
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

        // If this is a child deal, update parent's child list
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
     * @param _dealId Deal identifier
     * @param _resultHash IPFS hash or link to work
     */
    function submitWork(
        bytes32 _dealId,
        string calldata _resultHash
    ) external nonReentrant {
        Deal storage deal = deals[_dealId];
        require(deal.state == DealState.LOCKED, "Invalid deal state");
        require(msg.sender == deal.seller, "Not authorized");

        deal.resultHash = _resultHash;
        deal.state = DealState.VERIFYING;

        emit WorkSubmitted(_dealId, msg.sender, _resultHash);
    }

    /**
     * @dev Raise a dispute.
     * @param _dealId Deal identifier
     */
    function raiseDispute(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        require(
            deal.state == DealState.LOCKED || deal.state == DealState.VERIFYING,
            "Invalid deal state"
        );
        require(
            msg.sender == deal.buyer || msg.sender == deal.seller,
            "Not authorized"
        );

        deal.state = DealState.DISPUTE;
        emit DisputeRaised(_dealId, msg.sender);
    }

    /**
     * @dev Resolve a dispute (Buyer or Arbiter only for now).
     * @param _dealId Deal identifier
     * @param _releaseToSeller True to release to seller, False to refund buyer
     */
    function resolveDispute(
        bytes32 _dealId,
        bool _releaseToSeller,
        string calldata _judgmentCid
    ) external nonReentrant {
        Deal storage deal = deals[_dealId];
        require(deal.state == DealState.DISPUTE, "Invalid deal state");
        // Only Arbiter can resolve disputes
        require(msg.sender == arbiter, "Not authorized: Arbiter only");

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
     * @param _dealId Deal identifier
     */
    function release(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        require(
            deal.state == DealState.LOCKED || deal.state == DealState.VERIFYING,
            "Invalid deal state"
        );
        // Buyer, Arbiter, or ValidationBridge can release
        require(
            msg.sender == deal.buyer ||
                msg.sender == arbiter ||
                msg.sender == validationBridge,
            "Not authorized"
        );

        // Enforce time-lock if specified
        if (deal.expiresAt > 0) {
            require(
                block.timestamp >= deal.expiresAt,
                "Deal is time-locked, cannot release yet"
            );
        }

        deal.state = DealState.COMPLETED;

        // Transfer to seller's internal balance
        _distributeWithFee(_dealId, deal.seller, deal.token, deal.amount);

        emit DealReleased(_dealId, deal.seller, deal.amount);
    }

    /**
     * @dev Refund funds to buyer.
     * @param _dealId Deal identifier
     */
    function refund(bytes32 _dealId) external nonReentrant {
        Deal storage deal = deals[_dealId];
        require(
            deal.state == DealState.LOCKED || deal.state == DealState.VERIFYING,
            "Invalid deal state"
        );
        // Only Seller can refund (TODO: Add Arbiter)
        require(msg.sender == deal.seller, "Not authorized");

        deal.state = DealState.REFUNDED;

        // Transfer back to buyer's internal balance
        balances[deal.buyer][deal.token] += deal.amount;

        emit DealRefunded(_dealId, deal.buyer, deal.amount);
    }

    /**
     * @dev Get all child deal IDs for a given deal
     * @param _dealId Deal identifier
     * @return Array of child deal IDs
     */
    function getDealChildren(
        bytes32 _dealId
    ) external view returns (bytes32[] memory) {
        return deals[_dealId].childDealIds;
    }

    /**
     * @dev Check if a deal has a parent
     * @param _dealId Deal identifier
     * @return True if deal has a parent, false otherwise
     */
    function hasParent(bytes32 _dealId) external view returns (bool) {
        return deals[_dealId].parentDealId != bytes32(0);
    }

    /**
     * @dev Get deal metadata
     * @param _dealId Deal identifier
     * @return Deal metadata bytes
     */
    function getDealMetadata(
        bytes32 _dealId
    ) external view returns (bytes memory) {
        return deals[_dealId].metadata;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Session Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Set the authorized GatewaySession contract address (only owner)
     * @param _gatewaySession Address of the GatewaySession contract
     */
    function setGatewaySession(address _gatewaySession) external onlyOwner {
        gatewaySession = _gatewaySession;
        emit GatewaySessionUpdated(_gatewaySession);
    }

    /**
     * @dev Lock funds from agent's internal balance for a session (only GatewaySession contract)
     * @param _sessionId Unique session identifier
     * @param _agent Agent whose funds are being locked
     * @param _provider Service provider who will receive payment
     * @param _token Token address (use address(0) for ETH)
     * @param _amount Amount to lock
     */
    function lockForSession(
        bytes32 _sessionId,
        address _agent,
        address _provider,
        address _token,
        uint256 _amount
    ) external nonReentrant {
        require(msg.sender == gatewaySession, "Only GatewaySession can lock");
        require(sessionLocks[_sessionId] == 0, "Session already exists");
        require(balances[_agent][_token] >= _amount, "Insufficient balance");
        require(_amount > 0, "Amount must be > 0");
        require(_provider != address(0), "Invalid provider");

        // Deduct from agent's internal balance
        balances[_agent][_token] -= _amount;

        // Store session info
        sessionLocks[_sessionId] = _amount;
        sessionInfo[_sessionId] = SessionInfo({
            agent: _agent,
            provider: _provider,
            token: _token
        });

        emit SessionLocked(_sessionId, _agent, _provider, _token, _amount);
    }

    /**
     * @dev Unlock session funds: distribute used amount to provider, refund remainder to agent (only GatewaySession contract)
     * @param _sessionId Session identifier
     * @param _usedAmount Amount consumed during session (goes to provider)
     */
    function unlockSession(
        bytes32 _sessionId,
        uint256 _usedAmount
    ) external nonReentrant {
        require(msg.sender == gatewaySession, "Only GatewaySession can unlock");

        uint256 lockedAmount = sessionLocks[_sessionId];
        require(lockedAmount > 0, "Session does not exist");
        require(_usedAmount <= lockedAmount, "Used exceeds locked");

        SessionInfo memory info = sessionInfo[_sessionId];
        uint256 refundAmount = lockedAmount - _usedAmount;

        // Clear session (prevent reentrancy)
        sessionLocks[_sessionId] = 0;

        // Transfer used amount to provider's internal balance
        if (_usedAmount > 0) {
            _distributeWithFee(
                _sessionId,
                info.provider,
                info.token,
                _usedAmount
            );
        }

        // Refund remainder to agent's internal balance
        if (refundAmount > 0) {
            balances[info.agent][info.token] += refundAmount;
        }

        emit SessionUnlocked(_sessionId, _usedAmount, refundAmount);
    }

    /**
     * @dev Get session info (view function for SDK/frontend)
     * @param _sessionId Session identifier
     * @return lockedAmount The amount locked for this session
     * @return agent The agent who locked funds
     * @return provider The service provider
     * @return token The token used for payment
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

    /**
     * @dev Internal helper to distribute funds with protocol fee deduction
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
