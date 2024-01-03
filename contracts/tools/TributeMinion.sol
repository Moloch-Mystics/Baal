// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;
import "../Baal.sol";

interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);
}

contract TributeMinion {
    event TributeProposal(
        address indexed baal,
        address token,
        uint256 amount,
        address recipient,
        uint256 proposalId
    );
    struct Escrow {
        address token;
        address applicant;
        uint256 amount;
        bool released;
        address safe;
    }
    mapping(address => mapping(uint256 => Escrow)) public escrows;

    event EscrowReleased(
        address indexed baal,
        uint32 proposalId,
        address applicant,
        address safe,
        uint256 amount
    );

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
            "releaseEscrow(address,uint32)",
            baal,
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
        uint32 expiration,
        uint256 baalgas,
        string memory details
    ) external payable {
        uint32 proposalId = baal.proposalCount() + 1;

        bytes memory encodedProposal = encodeTributeProposal(
            address(baal),
            shares,
            loot,
            msg.sender,
            proposalId,
            address(this)
        );

        escrows[address(baal)][proposalId] = Escrow(
            token,
            msg.sender,
            amount,
            false,
            baal.target()
        );

        baal.submitProposal{value:msg.value}(encodedProposal, expiration, baalgas, details);

        emit TributeProposal(
            address(baal),
            token,
            amount,
            msg.sender,
            proposalId
        );
    }

    function releaseEscrow(address _baal, uint32 _proposalId) external {
        Baal baal = Baal(_baal);
        Escrow storage escrow = escrows[address(baal)][_proposalId];
        require(!escrow.released, "Already released");

        bool[4] memory status = baal.getProposalStatus(_proposalId);
        require(status[2], "Not passed");
        escrow.released = true;

        IERC20 token = IERC20(escrow.token);

        emit EscrowReleased(
            _baal,
            _proposalId,
            escrow.applicant,
            escrow.safe,
            escrow.amount
        );

        require(
            token.transferFrom(escrow.applicant, escrow.safe, escrow.amount),
            "Transfer failed"
        );
    }
}
