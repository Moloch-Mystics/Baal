/*
██████╗  ██████╗ ███████╗████████╗███████╗██████╗
██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
██████╔╝██║   ██║███████╗   ██║   █████╗  ██████╔╝
██╔═══╝ ██║   ██║╚════██║   ██║   ██╔══╝  ██╔══██╗
██║     ╚██████╔╝███████║   ██║   ███████╗██║  ██║
╚═╝      ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
A ridiculously simple general purpose social media smart contract.
It takes two strings (content and tag) as parameters and emits those strings, along with msg.sender, as an event. That's it.
Made with ❤️ by Auryn.eth
*/
// SPDX-License-Identifier: LGPL-3.0-only

pragma solidity 0.8.7;

contract Poster {
    event NewPost(address indexed user, string content, string indexed tag);

    function post(string calldata content, string calldata tag) external {
        emit NewPost(msg.sender, content, tag);
    }
}
