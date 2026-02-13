program main
    use math_utils
    implicit none

    integer :: result

    result = sum_squares(10)
    print '(A, I0)', 'Sum of squares 1..10 = ', result

end program main
