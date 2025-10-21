// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract MockPriceOracle is Ownable {
    mapping(address => uint256) public assetPrices;
    
    event PriceUpdated(address indexed asset, uint256 price);

    function setAssetPrice(address _asset, uint256 _price) external onlyOwner {
        assetPrices[_asset] = _price;
        emit PriceUpdated(_asset, _price);
    }

    function getAssetPrice(address _asset) external view returns (uint256) {
        return assetPrices[_asset];
    }
}