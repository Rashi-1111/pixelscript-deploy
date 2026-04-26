async function fetchCurrentUser() {
    try {
        const response = await fetch('/api/users/me', {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0'
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch (error) {
        return null;
    }
}

// Load user profile picture in navbar
async function loadProfilePicture() {
    try {
        const data = await fetchCurrentUser();
        if (!data) {
            sessionStorage.removeItem('user');
            window.location.href = 'login.html';
            return;
        }
        sessionStorage.setItem('user', JSON.stringify(data));
        
        // Keep home behavior close to the original flow and only send readers
        // to the reading area automatically.
        if (data.role === 'consumer') {
            window.location.href = 'stories.html';
            return;
        }
        
        const profilePic = document.getElementById('nav-profile-pic') || document.getElementById('headerProfilePic') || document.getElementById('profileImage');
        
        if (profilePic) {
            profilePic.src = data.profilePicture || 'images/user-1.png';
        }
    } catch (error) {
        console.error('Error loading profile picture:', error);
        sessionStorage.removeItem('user');
        window.location.href = 'login.html';
    }
}

// Handle logout
async function handleLogout() {
    try {
        await fetch('/api/users/logout', {
            method: 'POST'
        });
    } catch (error) {
        // Ignore network errors during logout request.
    }

    localStorage.removeItem('userProfile');
    sessionStorage.clear();
    
    // Clear any cached data
    if (window.caches) {
        caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => {
                caches.delete(cacheName);
            });
        });
    }
    
    // Redirect to login page
    window.location.href = 'login.html';
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadProfilePicture();
}); 
