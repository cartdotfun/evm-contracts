// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CartToken is ERC20, ERC20Burnable, Ownable {
    constructor(address initialOwner) ERC20("Cart.fun Token", "CART") Ownable(initialOwner) {
        _mint(initialOwner, 1_000_000_000 * 10 ** decimals()); // 1 Billion Supply
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
