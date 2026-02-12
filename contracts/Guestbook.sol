// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Guestbook
 * @notice On-chain guestbook - post permanent messages to Robinhood Chain
 */
contract Guestbook {
    struct Message {
        address author;
        string content;
        uint256 timestamp;
    }

    Message[] public messages;

    event MessagePosted(address indexed author, string content, uint256 indexed messageId);

    function post(string calldata _content) external {
        require(bytes(_content).length > 0, "Empty message");
        require(bytes(_content).length <= 280, "Max 280 chars"); // tweet-sized

        uint256 id = messages.length;
        messages.push(Message({
            author: msg.sender,
            content: _content,
            timestamp: block.timestamp
        }));

        emit MessagePosted(msg.sender, _content, id);
    }

    function getMessage(uint256 _id) external view returns (
        address author,
        string memory content,
        uint256 timestamp
    ) {
        require(_id < messages.length, "Invalid id");
        Message memory m = messages[_id];
        return (m.author, m.content, m.timestamp);
    }

    function getTotalMessages() external view returns (uint256) {
        return messages.length;
    }
}
