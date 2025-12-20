// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ITrustEngine.sol";

contract MaliciousReentrant {
    ITrustEngine public trustEngine;
    bool public attackMode;

    constructor(address _trustEngine) {
        trustEngine = ITrustEngine(_trustEngine);
    }

    // Allow receiving ETH
    receive() external payable {
        if (attackMode) {
            // Stop infinite loop to avoid OutOfGas before Reentrancy check
            attackMode = false; 
            trustEngine.withdraw(address(0), 1 ether);
        }
    }

    function attackWithdraw() external payable {
        require(msg.value >= 1 ether, "Need ETH");
        
        // 1. Deposit
        trustEngine.deposit{value: 1 ether}(address(0), 1 ether);
        
        // 2. Enable attack
        attackMode = true;
        
        // 3. Withdraw (triggering receive)
        trustEngine.withdraw(address(0), 1 ether);
    }
}
