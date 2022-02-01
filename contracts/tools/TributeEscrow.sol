// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;
import "../Baal.sol";

contract TributeEscrow {
    struct Escrow {
        address token;
        address applicant;
        uint256 amount;
        address baal;
        bool released;
    }
    mapping(address => mapping(uint256 => Escrow)) escrows;

    function submitTributeProposal(
        Baal baal,
        IERC20 tribute,
        uint256 amount,
        uint256 shares,
        uint256 loot,
        address recipient
    ) public {
        bytes memory _issueShares = abi.encodeWithSignature(
            "mintShares(address[],uint256[])",
            [recipient],
            [shares]
        );
        bytes memory _issueLoot = abi.encodeWithSignature(
            "mintLoot(address[],uint256[])",
            [recipient],
            [loot]
        );

        uint32 proposalId = baal.proposalCount() + 1;
        bytes memory _releaseEscrow = abi.encodeWithSignature(
            "releaseEscrow(uint32)",
            proposalId
        );

        bytes memory tributeMultisend = abi.encodePacked(
            uint8(0),
            address(this),
            uint256(0),
            uint256(_releaseEscrow.length),
            bytes(_releaseEscrow)
        );

        if (shares > 0) {
            tributeMultisend = abi.encodePacked(
                tributeMultisend,
                uint8(0),
                address(baal),
                uint256(0),
                uint256(_issueShares.length),
                bytes(_issueShares)
            );
        }
        if (loot > 0) {
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
    }

    function releaseEscrow(uint32 proposalId) public {
        Baal baal = Baal(payable(msg.sender));
        Escrow storage escrow = escrows[address(baal)][proposalId];
        require(!escrow.released, "Already released");

        require(baal.didProposalPass(proposalId), "Not passed");
        escrow.released = true;

        IERC20 token = IERC20(escrow.token);

        require(
            token.transferFrom(escrow.applicant, address(baal), escrow.amount),
            "Transfer failed"
        );
    }
}
