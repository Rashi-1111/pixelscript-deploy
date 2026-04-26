function getDashboardPathForRole(role) {
    switch ((role || '').toLowerCase()) {
        case 'consumer':
            return '/stories.html';
        case 'writer':
            return '/home.html';
        case 'artist':
            return '/home.html';
        case 'editor':
            return '/creator-dashboard.html';
        default:
            return '/home.html';
    }
}

async function fetchCurrentUserForRouting() {
    const response = await fetch('/api/users/me', {
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
        }
    });

    if (!response.ok) {
        throw new Error('Failed to load current user');
    }

    return response.json();
}

window.getDashboardPathForRole = getDashboardPathForRole;
window.fetchCurrentUserForRouting = fetchCurrentUserForRouting;
