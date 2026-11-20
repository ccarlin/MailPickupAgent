const RECIPIENTS_PREFIX = 'Recipients=';

function localPart(value) {
    const match = String(value || '').match(/([A-Za-z0-9._%+-]+)@/);
    return match ? match[1].toLowerCase() : '';
}

function getLocalRecipient(headerContents, toAddresses) {
    const lines = (headerContents || '').split(/\r?\n/);
    for (const line of lines) {
        if (!line.startsWith(RECIPIENTS_PREFIX)) continue;
        const local = localPart(line);
        if (local) return local;
    }

    const addresses = Array.isArray(toAddresses) ? toAddresses : [];
    for (const address of addresses) {
        const local = localPart(address);
        if (local) return local;
    }

    return '';
}

module.exports = { getLocalRecipient };
