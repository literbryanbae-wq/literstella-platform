export default {
  title: 'LiterStella Platform',
  description: 'Documentation for LiterStella projects',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Projects', link: '/diagnosis' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' }
        ]
      },
      {
        text: 'Development',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'DB Schema', link: '/db-schema' },
          { text: 'API Spec', link: '/api-spec' }
        ]
      },
      {
        text: 'Projects',
        items: [
          { text: 'Reading Diagnosis', link: '/diagnosis' },
          { text: 'Challenge', link: '/challenge' },
          { text: 'Coaching Partner', link: '/coaching' }
        ]
      }
    ]
  }
}
