// Search functionality
class TextSearcher {
    constructor() {
        this.searchResults = [];
        this.currentIndex = -1;
        this.searchTerm = '';
        this.highlightClass = 'search-highlight';
        this.activeHighlightClass = 'search-highlight-active';
    }

    // Initialize search functionality
    init() {
        // Create search container
        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';
        searchContainer.innerHTML = `
            <div class="search-bar">
                <input type="text" id="searchInput" placeholder="Search...">
                <div class="search-controls">
                    <span id="searchCount"></span>
                    <button id="prevResult" disabled><i class="fas fa-chevron-up"></i></button>
                    <button id="nextResult" disabled><i class="fas fa-chevron-down"></i></button>
                    <button id="closeSearch"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `;
        document.body.appendChild(searchContainer);

        // Add event listeners
        const searchInput = document.getElementById('searchInput');
        const prevButton = document.getElementById('prevResult');
        const nextButton = document.getElementById('nextResult');
        const closeButton = document.getElementById('closeSearch');

        // Show search bar on Ctrl+F
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                searchContainer.style.display = 'block';
                searchInput.focus();
            }
            if (e.key === 'Escape') {
                this.closeSearch();
            }
        });

        // Search as user types
        searchInput.addEventListener('input', () => {
            this.searchTerm = searchInput.value;
            this.performSearch();
        });

        // Navigation buttons
        prevButton.addEventListener('click', () => this.navigateResults('prev'));
        nextButton.addEventListener('click', () => this.navigateResults('next'));
        closeButton.addEventListener('click', () => this.closeSearch());
    }

    // Perform the search
    performSearch() {
        // Remove existing highlights
        this.clearHighlights();

        if (!this.searchTerm) {
            this.updateControls();
            return;
        }

        // Get all text nodes
        const textNodes = [];
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip script and style tags
                    if (node.parentNode.tagName === 'SCRIPT' || 
                        node.parentNode.tagName === 'STYLE' ||
                        node.parentNode.classList.contains('search-container')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        // Search and highlight matches
        this.searchResults = [];
        const searchTermLower = this.searchTerm.toLowerCase();

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const textLower = text.toLowerCase();
            let index = textLower.indexOf(searchTermLower);

            while (index !== -1) {
                const range = document.createRange();
                range.setStart(textNode, index);
                range.setEnd(textNode, index + this.searchTerm.length);

                const span = document.createElement('span');
                span.className = this.highlightClass;
                range.surroundContents(span);

                this.searchResults.push(span);

                // Update text node and index for next iteration
                textNode = span.nextSibling;
                if (!textNode) break;
                
                const remainingText = textNode.textContent;
                const remainingTextLower = remainingText.toLowerCase();
                index = remainingTextLower.indexOf(searchTermLower);
            }
        });

        // Reset current index and update controls
        this.currentIndex = this.searchResults.length ? 0 : -1;
        this.updateControls();
        if (this.currentIndex !== -1) {
            this.highlightCurrent();
        }
    }

    // Navigate through results
    navigateResults(direction) {
        if (!this.searchResults.length) return;

        // Remove active highlight from current result
        if (this.currentIndex !== -1) {
            this.searchResults[this.currentIndex].classList.remove(this.activeHighlightClass);
        }

        // Update current index
        if (direction === 'next') {
            this.currentIndex = (this.currentIndex + 1) % this.searchResults.length;
        } else {
            this.currentIndex = (this.currentIndex - 1 + this.searchResults.length) % this.searchResults.length;
        }

        this.highlightCurrent();
    }

    // Highlight current result and scroll into view
    highlightCurrent() {
        const current = this.searchResults[this.currentIndex];
        current.classList.add(this.activeHighlightClass);
        current.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    // Update search controls
    updateControls() {
        const countElement = document.getElementById('searchCount');
        const prevButton = document.getElementById('prevResult');
        const nextButton = document.getElementById('nextResult');
        
        if (!this.searchTerm || !this.searchResults.length) {
            countElement.textContent = 'No results';
            prevButton.disabled = true;
            nextButton.disabled = true;
            return;
        }
        
        countElement.textContent = `${this.currentIndex + 1} of ${this.searchResults.length}`;
        prevButton.disabled = this.currentIndex === 0;
        nextButton.disabled = this.currentIndex === this.searchResults.length - 1;
        
        // Highlight current result
        this.searchResults.forEach((result, index) => {
            result.classList.toggle('text-highlight-active', index === this.currentIndex);
        });
    }

    // Clear all highlights
    clearHighlights() {
        const highlights = document.querySelectorAll(`.${this.highlightClass}`);
        highlights.forEach(highlight => {
            const parent = highlight.parentNode;
            parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
            parent.normalize();
        });
        this.searchResults = [];
        this.currentIndex = -1;
    }

    // Close search
    closeSearch() {
        const searchContainer = document.querySelector('.search-container');
        const searchInput = document.getElementById('searchInput');
        searchContainer.style.display = 'none';
        searchInput.value = '';
        this.searchTerm = '';
        this.clearHighlights();
    }
}

// Initialize search when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const searcher = new TextSearcher();
    searcher.init();
});
