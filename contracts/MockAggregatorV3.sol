// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * Mock Chainlink price feed for testnet simulation.
 * Implements AggregatorV3Interface with owner-controlled setPrice.
 * Use for liquidation testing: setPrice to simulate drops.
 * Only owner can setPrice to prevent griefing in shared testnet.
 */
contract MockAggregatorV3 is Ownable {
    int256 public price;
    uint80 public roundId;
    uint256 public updatedAt;
    string private _description;

    constructor(int256 _initialPrice, string memory _desc) Ownable(msg.sender) {
        price = _initialPrice;
        roundId = 1;
        updatedAt = block.timestamp;
        _description = _desc;
    }

    function setPrice(int256 _price) external onlyOwner {
        price = _price;
        updatedAt = block.timestamp;
        roundId++;
    }

    function latestRoundData() external view returns (
        uint80 _roundId,
        int256 answer,
        uint256 startedAt,
        uint256 _updatedAt,
        uint80 answeredInRound
    ) {
        return (roundId, price, updatedAt, updatedAt, roundId);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _rId) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if (_rId == roundId) {
            return (roundId, price, updatedAt, updatedAt, roundId);
        }
        revert("Round not found");
    }
}
