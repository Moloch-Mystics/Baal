// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;
import "../Baal.sol";

import "hardhat/console.sol";

contract TributeEscrow {
    struct Escrow {
        address token;
        address applicant;
        uint256 amount;
        bool released;
    }
    mapping(address => mapping(uint256 => Escrow)) escrows;

    function encodeTributeProposal(
        address baal,
        uint256 shares,
        uint256 loot,
        address recipient,
        uint32 proposalId,
        address escrow
    ) public pure returns (bytes memory) {
        // Workaround for solidity dynamic memory array
        address[] memory _recipients = new address[](1);
        _recipients[0] = recipient;

        bytes memory _releaseEscrow = abi.encodeWithSignature(
            "releaseEscrow(uint32)",
            proposalId
        );

        bytes memory tributeMultisend = abi.encodePacked(
            uint8(0),
            escrow,
            uint256(0),
            uint256(_releaseEscrow.length),
            bytes(_releaseEscrow)
        );

        if (shares > 0) {
            // Workaround for solidity dynamic memory array
            uint256[] memory _shares = new uint256[](1);
            _shares[0] = shares;

            bytes memory _issueShares = abi.encodeWithSignature(
                "mintShares(address[],uint256[])",
                _recipients,
                _shares
            );

            tributeMultisend = abi.encodePacked(
                tributeMultisend,
                uint8(0),
                baal,
                uint256(0),
                uint256(_issueShares.length),
                bytes(_issueShares)
            );
        }
        if (loot > 0) {
            // Workaround for solidity dynamic memory array
            uint256[] memory _loot = new uint256[](1);
            _loot[0] = loot;

            bytes memory _issueLoot = abi.encodeWithSignature(
                "mintLoot(address[],uint256[])",
                _recipients,
                _loot
            );

            tributeMultisend = abi.encodePacked(
                tributeMultisend,
                uint8(0),
                address(baal),
                uint256(0),
                uint256(_issueLoot.length),
                bytes(_issueLoot)
            );
        }

        bytes memory _multisendAction = abi.encodeWithSignature(
            "multiSend(bytes)",
            tributeMultisend
        );
        return _multisendAction;
    }

    function submitTributeProposal(
        Baal baal,
        address token,
        uint256 amount,
        uint256 shares,
        uint256 loot,
        address recipient,
        uint32 expiration,
        string memory details
    ) public {
        uint32 proposalId = baal.proposalCount() + 1;
        bytes memory encodedProposal = encodeTributeProposal(
            address(baal),
            shares,
            loot,
            recipient,
            proposalId,
            address(this)
        );
        escrows[address(baal)][proposalId] = Escrow(
            token,
            recipient,
            amount,
            false
        );
        baal.submitProposal(encodedProposal, expiration, details);
    }

    function releaseEscrow(uint32 proposalId) external {
        Baal baal = Baal(payable(msg.sender));
        Escrow storage escrow = escrows[address(baal)][proposalId];
        require(!escrow.released, "Already released");

        bool[4] memory status = baal.getProposalStatus(proposalId);
        require(status[2], "Not passed");
        escrow.released = true;

        IERC20 token = IERC20(escrow.token);

        require(
            token.transferFrom(escrow.applicant, address(baal), escrow.amount),
            "Transfer failed"
        );
    }
}
