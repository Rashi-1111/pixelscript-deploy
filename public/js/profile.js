// Load user profile data
async function loadProfile() {
    try {
        const response = await fetch(`/api/users/me?t=${Date.now()}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

        if (response.ok) {
            const user = await response.json();
            displayProfile(user);
        } else if (response.status === 401) {
            sessionStorage.removeItem('user');
            window.location.href = '/login.html';
        } else {
            throw new Error('Failed to load profile');
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        alert('Failed to load profile data');
    }
}

// Clear existing profile data
function clearProfileData() {
    const elements = [
        'profileName',
        'profileRole',
        'profileBio',
        'profileGenres',
        'profileSkills'
    ];

    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            if (element.tagName === 'IMG') {
                element.src = 'images/default-profile.png';
            } else {
                element.textContent = '';
                element.innerHTML = '';
            }
        }
    });
}

// Display profile data
function displayProfile(user) {
    if (!user) return;
    
    // Update form fields
    document.getElementById('name').value = user.name || '';
    document.getElementById('bio').value = user.bio || '';
    document.getElementById('profileName').textContent = user.name || '';
    document.getElementById('profileRole').textContent = user.role || 'Creator';
    document.getElementById('profilePicture').src = user.profilePicture || 'images/user-1.png';
    
    // Save to localStorage and trigger storage event
    const profileData = {
        name: user.name || 'User',
        role: user.role || 'Creator',
        avatar: user.profilePicture || 'images/user-1.png'
    };
    
    // Remove and set to trigger storage event
    localStorage.removeItem('userProfile');
    localStorage.setItem('userProfile', JSON.stringify(profileData));
    
    // Dispatch storage event for same-page updates
    window.dispatchEvent(new StorageEvent('storage', {
        key: 'userProfile',
        newValue: JSON.stringify(profileData),
        storageArea: localStorage
    }));
    
    // Update genres
    const genresSelect = document.getElementById('genres');
    if (user.genres && user.genres.length > 0) {
        Array.from(genresSelect.options).forEach(option => {
            option.selected = user.genres.includes(option.value);
        });
    }

    // Update skills
    document.getElementById('skills').value = user.skills ? user.skills.join(', ') : '';

    // Display genres
    const genresList = document.getElementById('profileGenres');
    genresList.innerHTML = user.genres && user.genres.length > 0 
        ? user.genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')
        : '<p>No genres selected</p>';

    // Display skills
    const skillsList = document.getElementById('profileSkills');
    skillsList.innerHTML = user.skills && user.skills.length > 0
        ? user.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')
        : '<p>No skills added</p>';
}

// Handle profile image upload
const legacyProfileImageInput = document.getElementById('profileImageInput');
if (legacyProfileImageInput) {
    legacyProfileImageInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('profilePicture', file);

            try {
                const response = await fetch('/api/users/profile-picture', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const updatedUser = await response.json();
                    const profilePic = document.getElementById('profilePicture');
                    if (profilePic) {
                        profilePic.src = updatedUser.profilePicture || 'images/user-1.png';
                    }
                } else {
                    throw new Error('Failed to update profile picture');
                }
            } catch (error) {
                console.error('Error updating profile picture:', error);
            }
        }
    });
}

// Save profile updates
async function saveProfile(e) {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('name', document.getElementById('name').value);
    formData.append('bio', document.getElementById('bio').value);
    formData.append('role', document.getElementById('role').value || 'Artist');
    
    // Get selected genres
    const genresSelect = document.getElementById('genres');
    const selectedGenres = Array.from(genresSelect.selectedOptions).map(option => option.value);
    formData.append('genres', JSON.stringify(selectedGenres));
    
    // Get skills
    const skills = document.getElementById('skills').value.split(',').map(skill => skill.trim());
    formData.append('skills', JSON.stringify(skills));

    try {
        const response = await fetch('/api/users/profile', {
            method: 'PUT',
            body: formData
        });

        if (response.ok) {
            const updatedUser = await response.json();
            displayProfile(updatedUser);
            
            // Update localStorage for matching page
            localStorage.setItem('userProfile', JSON.stringify({
                name: updatedUser.name || 'User',
                role: updatedUser.role || 'Creator',
                avatar: updatedUser.profilePicture || 'images/user-1.png'
            }));
            
            alert('Profile saved successfully');
        } else {
            throw new Error('Failed to save profile');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('Failed to save profile');
    }
}

// Open edit modal
function openEditModal() {
    const editModal = document.getElementById('editModal');
    editModal.style.display = 'flex';

    // Pre-fill the modal with current data
    document.getElementById('editUsername').value = document.getElementById('userName').textContent;
    document.getElementById('bioInput').value = document.getElementById('userBio').textContent.replace(/"/g, '');
    document.getElementById('interestsInput').value = document.getElementById('userInterests').textContent;
}

// Close edit modal
function closeEditModal() {
    const editModal = document.getElementById('editModal');
    editModal.style.display = 'none';
}

// Save profile from modal
function saveProfileFromModal() {
    const newUsername = document.getElementById('editUsername').value;
    const newBio = document.getElementById('bioInput').value;
    const newInterests = document.getElementById('interestsInput').value;

    // Update the profile display
    document.getElementById('userName').textContent = newUsername;
    document.getElementById('userBio').textContent = `"${newBio}"`;
    document.getElementById('userInterests').textContent = newInterests;

    // Close the modal
    closeEditModal();
}

// Open upload modal
function openUploadModal() {
    document.getElementById('uploadOverlay').style.display = 'block';
    document.getElementById('uploadModal').style.display = 'block';
}

// Close upload modal
function closeUploadModal() {
    document.getElementById('uploadOverlay').style.display = 'none';
    document.getElementById('uploadModal').style.display = 'none';
}

const legacyUploadForm = document.getElementById('uploadForm');
if (legacyUploadForm) {
    legacyUploadForm.addEventListener('submit', function (e) {
        e.preventDefault();

    const title = document.getElementById('projectTitle').value;
    const description = document.getElementById('projectDescription').value;
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;

    if (files.length > 0) {
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const workGrid = document.getElementById('worksGrid');
                const workItem = document.createElement('div');
                workItem.className = 'work-item';
                workItem.innerHTML = `
                    <img src="${e.target.result}" alt="${title}" class="work-image">
                    <div class="work-overlay">
                        <h3>${title}</h3>
                        <p>${description}</p>
                        <div class="work-actions">
                            <button class="work-action-btn" onclick="viewWork('${e.target.result}')">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="work-action-btn" onclick="deleteWork(this)">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
                workGrid.appendChild(workItem);
            };
            reader.readAsDataURL(file);
        });

        // Clear the form and close the modal
        document.getElementById('uploadForm').reset();
        closeUploadModal();
    }
    });
}

function viewWork(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'view-work-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-btn">&times;</span>
            <img src="${imageSrc}" alt="Work Preview" class="work-preview">
        </div>
    `;
    document.body.appendChild(modal);

    // Close on X button click
    modal.querySelector('.close-btn').onclick = () => {
        modal.remove();
    };

    // Close on outside click
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    // Close on Escape key
    document.addEventListener('keydown', function closeOnEscape(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', closeOnEscape);
        }
    });
}

function deleteWork(button) {
    button.closest('.work-item').remove();
}

// Initialize profile page
document.addEventListener('DOMContentLoaded', () => {
    const legacyProfileForm = document.getElementById('profileForm');
    if (!legacyProfileForm) {
        return;
    }

    clearProfileData();
    loadProfile();
    legacyProfileForm.addEventListener('submit', saveProfile);
});
