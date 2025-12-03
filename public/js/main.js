// Main JavaScript for Supermarket App

// Carousel Functionality
document.addEventListener('DOMContentLoaded', function() {
    const carousel = document.querySelector('.carousel');
    
    if (carousel) {
        const slides = carousel.querySelector('.carousel-slides');
        const slideItems = carousel.querySelectorAll('.carousel-slide');
        const prevBtn = carousel.querySelector('.carousel-control.prev');
        const nextBtn = carousel.querySelector('.carousel-control.next');
        const indicators = carousel.querySelectorAll('.carousel-indicator');
        let currentIndex = 0;
        let slideInterval;
        
        // Set initial slide position
        updateSlidePosition();
        
        // Auto-advance slides
        startSlideInterval();
        
        // Event listeners
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                stopSlideInterval();
                currentIndex = (currentIndex - 1 + slideItems.length) % slideItems.length;
                updateSlidePosition();
                startSlideInterval();
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                stopSlideInterval();
                currentIndex = (currentIndex + 1) % slideItems.length;
                updateSlidePosition();
                startSlideInterval();
            });
        }
        
        indicators.forEach(indicator => {
            indicator.addEventListener('click', () => {
                stopSlideInterval();
                currentIndex = parseInt(indicator.dataset.index);
                updateSlidePosition();
                startSlideInterval();
            });
        });
        
        // Pause on hover
        carousel.addEventListener('mouseenter', stopSlideInterval);
        carousel.addEventListener('mouseleave', startSlideInterval);
        
        // Update slide position
        function updateSlidePosition() {
            const slideWidth = 100;
            slides.style.transform = `translateX(-${currentIndex * slideWidth}%)`;
            
            // Update active indicator
            indicators.forEach((indicator, index) => {
                if (index === currentIndex) {
                    indicator.classList.add('active');
                } else {
                    indicator.classList.remove('active');
                }
            });
        }
        
        // Auto slide functions
        function startSlideInterval() {
            slideInterval = setInterval(() => {
                currentIndex = (currentIndex + 1) % slideItems.length;
                updateSlidePosition();
            }, 5000); // Change slide every 5 seconds
        }
        
        function stopSlideInterval() {
            clearInterval(slideInterval);
        }
    }
});

// Add to cart animation
document.querySelectorAll('.add-to-cart').forEach(button => {
    button.addEventListener('click', function(e) {
        // If it's a form submit button, let the form handle it
        if (this.type === 'submit') return;
        
        const originalText = this.textContent;
        this.textContent = 'Added!';
        this.style.backgroundColor = 'var(--primary)';
        this.style.color = 'white';
        
        setTimeout(() => {
            this.textContent = originalText;
            this.style.backgroundColor = '';
            this.style.color = '';
        }, 2000);
    });
});

// Sticky header effect
window.addEventListener('scroll', function() {
    const headerMain = document.querySelector('.header-main');
    if (headerMain) {
        if (window.scrollY > 50) {
            headerMain.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
        } else {
            headerMain.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        }
    }
});

let activeCategory = '';
let currentSearchTerm = '';

// Search functionality - works for both shopping page and inventory table
const searchInput = document.querySelector('.search-bar input');
if (searchInput) {
    // Create and add clear button
    const searchBar = document.querySelector('.search-bar');
    if (searchBar && !searchBar.querySelector('.search-clear')) {
        const clearBtn = document.createElement('i');
        clearBtn.className = 'fas fa-times search-clear';
        clearBtn.style.cssText = 'position: absolute; right: 15px; cursor: pointer; color: var(--dark-gray); display: none;';
        searchBar.style.position = 'relative';
        searchBar.appendChild(clearBtn);

        // Clear button click handler
        clearBtn.addEventListener('click', function() {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            // Trigger input event to reset display
            searchInput.dispatchEvent(new Event('input'));
        });

        // Show/hide clear button based on input
        searchInput.addEventListener('input', function() {
            const clearButton = searchBar.querySelector('.search-clear');
            if (this.value.length > 0) {
                clearButton.style.display = 'block';
            } else {
                clearButton.style.display = 'none';
            }
        });
    }

    searchInput.addEventListener('input', function(e) {
        currentSearchTerm = e.target.value.toLowerCase().trim();
        applyFilters();
    });
}

// Helper function to show/hide no results message
function showNoResultsMessage(containerSelector, visibleCount, searchTerm) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    
    let noResultsMsg = document.getElementById('noSearchResults');
    
    if (visibleCount === 0 && searchTerm !== '') {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.id = 'noSearchResults';
            noResultsMsg.style.cssText = 'text-align: center; padding: 60px 20px; color: var(--dark-gray);';
            noResultsMsg.innerHTML = `
                <i class="fas fa-search" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
                <h3>No results found</h3>
                <p>Try different keywords or clear your search</p>
            `;
            container.parentNode.insertBefore(noResultsMsg, container.nextSibling);
        }
        noResultsMsg.style.display = 'block';
        container.style.opacity = '0.3';
    } else {
        if (noResultsMsg) {
            noResultsMsg.style.display = 'none';
        }
        container.style.opacity = '1';
    }
}

function applyFilters() {
    const normalizedSearch = currentSearchTerm;
    let cardVisibleCount = 0;

    const productCards = document.querySelectorAll('.product-card');
    productCards.forEach(card => {
        const cardCategory = (card.getAttribute('data-category') || '').trim();
        const categoryMatch = !activeCategory || cardCategory === activeCategory;

        const nameElement = card.querySelector('.product-name');
        const productName = nameElement ? nameElement.textContent.toLowerCase() : '';
        const searchMatch = !normalizedSearch ||
            productName.includes(normalizedSearch) ||
            cardCategory.toLowerCase().includes(normalizedSearch);

        if (categoryMatch && searchMatch) {
            card.style.display = 'block';
            cardVisibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    showNoResultsMessage('.product-grid', cardVisibleCount, activeCategory || normalizedSearch);

    let rowVisibleCount = 0;
    const tableRows = document.querySelectorAll('.table tbody tr');
    tableRows.forEach(row => {
        const rowCategory = (row.getAttribute('data-category') || '').trim();
        const categoryMatch = !activeCategory || rowCategory === activeCategory;

        const nameCell = row.cells[2];
        const categoryCell = row.cells[3];
        const idCell = row.cells[0];

        const productName = nameCell ? nameCell.textContent.toLowerCase() : '';
        const categoryText = categoryCell ? categoryCell.textContent.toLowerCase() : rowCategory.toLowerCase();
        const productId = idCell ? idCell.textContent.toLowerCase() : '';

        const searchMatch = !normalizedSearch ||
            productName.includes(normalizedSearch) ||
            categoryText.includes(normalizedSearch) ||
            productId.includes(normalizedSearch);

        if (categoryMatch && searchMatch) {
            row.style.display = '';
            rowVisibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    showNoResultsMessage('.table', rowVisibleCount, activeCategory || normalizedSearch);
}

// Category filter
const categoryLinks = document.querySelectorAll('[data-filter-nav] a');
categoryLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault(); // Prevent default link behavior

        // Remove active class from all links within the same nav
        const parentNav = this.closest('[data-filter-nav]');
        if (parentNav) {
            parentNav.querySelectorAll('a').forEach(l => l.classList.remove('active'));
        }

        // Add active class to clicked link
        this.classList.add('active');

        // Update selected category and re-apply filters
        activeCategory = this.getAttribute('data-category') || '';
        applyFilters();
    });
});

// Apply filters on initial load to sync with any existing state
if (categoryLinks.length > 0 || (typeof searchInput !== 'undefined' && searchInput)) {
    applyFilters();
}

// Auto-hide alerts after 5 seconds
const alerts = document.querySelectorAll('.alert');
alerts.forEach(alert => {
    setTimeout(() => {
        alert.style.transition = 'opacity 0.5s';
        alert.style.opacity = '0';
        setTimeout(() => {
            alert.remove();
        }, 500);
    }, 5000);
});

// Confirm delete actions
const deleteLinks = document.querySelectorAll('a[href*="delete"], a[href*="Delete"]');
deleteLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        if (!confirm('Are you sure you want to delete this item?')) {
            e.preventDefault();
        }
    });
});

// Form validation
const forms = document.querySelectorAll('form[data-validate]');
forms.forEach(form => {
    form.addEventListener('submit', function(e) {
        const requiredInputs = form.querySelectorAll('[required]');
        let isValid = true;
        
        requiredInputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.style.borderColor = 'var(--danger)';
            } else {
                input.style.borderColor = '';
            }
        });
        
        if (!isValid) {
            e.preventDefault();
            alert('Please fill in all required fields');
        }
    });
});
