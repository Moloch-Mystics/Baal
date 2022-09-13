//SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

interface IBaal {
    function lootPaused() external returns (bool);

    function sharesPaused() external returns (bool);
}
