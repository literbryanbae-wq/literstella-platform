document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Switching Logic (Mode 3 Light Default to Mode 2 Dark)
    const themeToggle = document.getElementById('theme-toggle');
    const toggleIcon = document.getElementById('toggle-icon');
    const htmlElement = document.documentElement;

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            // Toggle 'dark' class on <html>
            htmlElement.classList.toggle('dark');
            
            // Update icon text dynamically
            if (htmlElement.classList.contains('dark')) {
                toggleIcon.innerText = 'light_mode';
            } else {
                toggleIcon.innerText = 'dark_mode';
            }
        });
    }

    // 2. Newsletter Form Logic
    const newsletterForm = document.getElementById('portalNewsletterForm');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Basic success feedback
            alert('구독 신청이 완료되었습니다. 매주 화요일에 뵙겠습니다.');
            newsletterForm.reset();
        });
    }
});
