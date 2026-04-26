document.addEventListener('DOMContentLoaded', () => {
    const searchBox = document.getElementById('search-box');
    const searchForm = document.querySelector('.search-form');
    const searchBtn = document.getElementById('search-btn');
    const mainContent = document.querySelector('body');
    
    let currentHighlight = -1;
    let highlights = [];
    const highlightClass = 'text-highlight';
    const activeHighlightClass = 'text-highlight-active';

    // Toggle search form
    searchBtn.addEventListener('click', () => {
        searchForm.classList.toggle('active');
        searchBox.focus();
    });

    // Search functionality
    searchBox.addEventListener('input', () => {
        // Remove existing highlights
        removeHighlights();
        
        const searchTerm = searchBox.value.trim();
        if (!searchTerm) return;

        // Find and highlight matches
        highlights = findAndHighlightMatches(searchTerm);
        
        // If there are matches, highlight the first one
        if (highlights.length > 0) {
            currentHighlight = 0;
            highlightCurrent();
        }
    });

    // Navigate with arrow keys
    searchBox.addEventListener('keydown', (e) => {
        if (highlights.length === 0) return;

        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            navigateHighlight('next');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateHighlight('prev');
        }
    });

    function findAndHighlightMatches(searchTerm) {
        const regex = new RegExp(searchTerm, 'gi');
        const walker = document.createTreeWalker(
            mainContent,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.parentElement.classList.contains('search-form')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const matches = [];
        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent;
            if (regex.test(text)) {
                const span = document.createElement('span');
                const highlighted = text.replace(regex, match => 
                    `<span class="${highlightClass}">${match}</span>`
                );
                span.innerHTML = highlighted;
                node.parentNode.replaceChild(span, node);
                
                // Collect all highlighted elements
                span.querySelectorAll(`.${highlightClass}`).forEach(el => {
                    matches.push(el);
                });
            }
        }
        return matches;
    }

    function removeHighlights() {
        // Remove active highlight class first
        const activeHighlight = document.querySelector(`.${activeHighlightClass}`);
        if (activeHighlight) {
            activeHighlight.classList.remove(activeHighlightClass);
        }

        // Remove all highlights
        document.querySelectorAll(`.${highlightClass}`).forEach(highlight => {
            const parent = highlight.parentNode;
            const text = document.createTextNode(highlight.textContent);
            parent.replaceChild(text, highlight);
            parent.normalize();
        });

        highlights = [];
        currentHighlight = -1;
    }

    function navigateHighlight(direction) {
        if (highlights.length === 0) return;

        // Remove active class from current highlight
        if (currentHighlight !== -1) {
            highlights[currentHighlight].classList.remove(activeHighlightClass);
        }

        // Update current highlight index
        if (direction === 'next') {
            currentHighlight = (currentHighlight + 1) % highlights.length;
        } else {
            currentHighlight = (currentHighlight - 1 + highlights.length) % highlights.length;
        }

        highlightCurrent();
    }

    function highlightCurrent() {
        const current = highlights[currentHighlight];
        current.classList.add(activeHighlightClass);
        current.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    // Close search when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-form') && !e.target.closest('#search-btn')) {
            searchForm.classList.remove('active');
            removeHighlights();
        }
    });
});
